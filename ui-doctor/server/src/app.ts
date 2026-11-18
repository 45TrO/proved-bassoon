import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { Repository } from './db/repository.js';
import type { HealthInfo } from './domain/types.js';
import { AnalysisService, ServiceError, type AiProvider } from './services/analysisService.js';

export const VERSION = '1.0.0';
const MAX_UPLOAD = 10 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE = /^[A-Za-z0-9._-]{1,140}\.(jpg|png|webp)$/;

const IdParams = z.object({ id: z.string().regex(UUID, 'id inválido') });
const IssueParams = IdParams.extend({ issueId: z.string().min(1).max(200) });
const CreateAnalysisBody = z.object({ url: z.string().trim().min(1, 'Informe uma URL.').max(2048, 'URL longa demais.') });
const IssueStatusBody = z.object({ status: z.enum(['open', 'implemented', 'dismissed']) });
const RedesignBody = z.object({ mode: z.enum(['preserve', 'full']).default('preserve') });
const ProjectPatch = z
  .object({ name: z.string().trim().min(1).max(120).optional(), favorite: z.boolean().optional() })
  .refine((v) => v.name !== undefined || v.favorite !== undefined, 'Nada para atualizar.');
const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const ProjectQuery = z.object({ favorites: z.enum(['1', 'true']).optional(), q: z.string().max(120).optional() });
const FileParams = z.object({ id: z.string().regex(UUID), file: z.string().regex(FILE) });

export interface BuildOptions {
  config: AppConfig;
  ai?: AiProvider | null;
  logger?: boolean;
}

export async function buildApp({ config, ai, logger = true }: BuildOptions) {
  const app: FastifyInstance = Fastify({
    logger: logger ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
    bodyLimit: 64 * 1024,
    trustProxy: false,
  });

  const db = openDatabase(config.dataDir);
  const repo = new Repository(db);
  const interrupted = repo.failInterrupted();
  if (interrupted) app.log.warn({ interrupted }, 'análises interrompidas marcadas como falha');
  const service = new AnalysisService(config, repo, ai === undefined ? undefined : ai);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD, files: 1, fields: 2 } });

  if (config.corsOrigin) {
    app.addHook('onRequest', async (req, reply) => {
      reply.header('access-control-allow-origin', config.corsOrigin!);
      reply.header('vary', 'origin');
      if (req.method === 'OPTIONS') {
        reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE');
        reply.header('access-control-allow-headers', 'content-type');
        return reply.code(204).send();
      }
    });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'validation', message: err.issues[0]?.message ?? 'Dados inválidos.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      });
    }
    if (err instanceof ServiceError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Muitas solicitações. Aguarde um minuto e tente novamente.' } });
    if (status === 413 || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'too_large', message: 'Arquivo maior que 10 MB.' } });
    }
    if (status < 500) return reply.code(status).send({ error: { code: 'bad_request', message: (err as Error).message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Erro interno. Tente novamente.' } });
  });

  const createLimit = { rateLimit: { max: config.rateLimitPerMinute, timeWindow: '1 minute' } };

  app.get('/api/health', async (): Promise<HealthInfo> => ({
    ok: true,
    version: VERSION,
    ai: { enabled: service.aiEnabled, model: service.aiEnabled ? config.anthropicModel : null },
    browser: true,
  }));

  app.get('/api/dashboard', async () => repo.dashboard());

  app.get('/api/analyses', async (req) => {
    const { limit } = ListQuery.parse(req.query);
    return repo.listAnalyses(limit);
  });

  app.post('/api/analyses', { config: createLimit }, async (req, reply) => {
    const { url } = CreateAnalysisBody.parse(req.body ?? {});
    const id = await service.startUrlAnalysis(url);
    return reply.code(202).send({ id });
  });

  app.post('/api/analyses/image', { config: createLimit }, async (req, reply) => {
    if (!req.isMultipart()) throw new ServiceError('Envie a imagem como multipart/form-data.', 400, 'bad_request');
    const file = await req.file();
    if (!file) throw new ServiceError('Nenhum arquivo enviado.', 400, 'bad_request');
    const data = await file.toBuffer();
    if (data.length === 0) throw new ServiceError('Arquivo vazio.', 400, 'bad_request');
    const id = await service.startImageAnalysis(file.filename, data);
    return reply.code(202).send({ id });
  });

  app.get('/api/analyses/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const a = repo.getAnalysis(id);
    if (!a) return reply.code(404).send({ error: { code: 'not_found', message: 'Análise não encontrada.' } });
    return a;
  });

  app.delete('/api/analyses/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!repo.deleteAnalysis(id)) return reply.code(404).send({ error: { code: 'not_found', message: 'Análise não encontrada.' } });
    await fs.rm(service.analysisDir(id), { recursive: true, force: true });
    return reply.code(204).send();
  });

  app.patch('/api/analyses/:id/issues/:issueId', async (req, reply) => {
    const { id, issueId } = IssueParams.parse(req.params);
    const { status } = IssueStatusBody.parse(req.body ?? {});
    if (!repo.setIssueStatus(id, issueId, status)) return reply.code(404).send({ error: { code: 'not_found', message: 'Problema não encontrado.' } });
    return { ok: true };
  });

  app.post('/api/analyses/:id/redesigns', { config: createLimit }, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const { mode } = RedesignBody.parse(req.body ?? {});
    const redesignId = service.startRedesign(id, mode);
    return reply.code(202).send({ id: redesignId });
  });

  app.get('/api/redesigns/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const r = repo.getRedesign(id);
    if (!r) return reply.code(404).send({ error: { code: 'not_found', message: 'Proposta não encontrada.' } });
    return r;
  });

  app.get('/api/projects', async (req) => {
    const q = ProjectQuery.parse(req.query);
    return repo.listProjects({ favorites: Boolean(q.favorites), q: q.q });
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const p = repo.getProject(id);
    if (!p) return reply.code(404).send({ error: { code: 'not_found', message: 'Projeto não encontrado.' } });
    return p;
  });

  app.patch('/api/projects/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const patch = ProjectPatch.parse(req.body ?? {});
    if (!repo.updateProject(id, patch)) return reply.code(404).send({ error: { code: 'not_found', message: 'Projeto não encontrado.' } });
    return { ok: true };
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const ids = repo.deleteProject(id);
    await Promise.all(ids.map((a) => fs.rm(service.analysisDir(a), { recursive: true, force: true })));
    return reply.code(204).send();
  });

  // Capturas: nome validado por regex e caminho resolvido dentro do diretório da análise.
  app.get('/api/files/:id/:file', async (req, reply) => {
    const parsed = FileParams.safeParse(req.params);
    if (!parsed.success) return reply.code(404).send({ error: { code: 'not_found', message: 'Arquivo não encontrado.' } });
    const { id, file } = parsed.data;
    const base = service.analysisDir(id);
    const full = path.resolve(base, file);
    if (!full.startsWith(base + path.sep)) return reply.code(404).send();
    try {
      const stat = await fs.stat(full);
      const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      reply.header('content-type', type).header('content-length', stat.size).header('cache-control', 'private, max-age=86400, immutable');
      reply.header('x-content-type-options', 'nosniff');
      return reply.send(createReadStream(full));
    } catch {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Arquivo não encontrado.' } });
    }
  });

  if (config.webDist) {
    // wildcard: serve arquivos criados após a inicialização (novo build sem reinício).
    await app.register(fastifyStatic, { root: config.webDist, wildcard: true, index: false });
    app.get('/', (_req, reply) => reply.type('text/html').header('cache-control', 'no-cache').sendFile('index.html'));
    app.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split('?')[0] ?? '';
      if (pathname.startsWith('/api/')) return reply.code(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.' } });
      // Arquivo inexistente (asset com extensão) é 404; só rotas de navegação recebem o SPA.
      if (req.method !== 'GET' || /\.[a-z0-9]{1,8}$/i.test(pathname)) return reply.code(404).type('text/plain').send('Not found');
      return reply.type('text/html').header('cache-control', 'no-cache').sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    db.close();
  });

  return { app, repo, service };
}
