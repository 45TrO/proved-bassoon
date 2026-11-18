import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeBrowser } from '../src/capture/browser.js';
import { loadConfig } from '../src/config.js';
import type { AnalysisDetail, DashboardStats, ProjectSummary, RedesignSummary } from '../src/domain/types.js';
import type { AnalysisService } from '../src/services/analysisService.js';
import { terminateOcr } from '../src/vision/ocr.js';
import { startFixtureServers, type Servers } from './fixtureServer.js';

let servers: Servers;
let dataDir: string;
let app: FastifyInstance;
let service: AnalysisService;

function multipart(filename: string, content: Buffer, type: string) {
  const boundary = '----uidoctor' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  servers = await startFixtureServers();
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uidoctor-api-'));
  const config = loadConfig({
    UIDOCTOR_DATA_DIR: dataDir,
    UIDOCTOR_ALLOW_PRIVATE_HOSTS: `127.0.0.1:${servers.sitePort}`,
    UIDOCTOR_RATE_LIMIT: '100',
  });
  ({ app, service } = await buildApp({ config, logger: false }));
});

afterAll(async () => {
  await app.close();
  await closeBrowser();
  await terminateOcr();
  await servers.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('API', () => {
  let analysisId = '';
  let detail: AnalysisDetail;

  it('health informa o OCR offline pronto', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json().vision).toEqual({ ocrLanguages: ['por', 'eng'], ocrReady: true });
  });

  it('valida entrada e recusa SSRF antes de enfileirar', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/analyses', payload: {} })).statusCode).toBe(400);
    const internal = await app.inject({ method: 'POST', url: '/api/analyses', payload: { url: 'http://169.254.169.254/latest' } });
    expect(internal.statusCode).toBe(422);
    expect(internal.json().error.code).toBe('private_address');
    const scheme = await app.inject({ method: 'POST', url: '/api/analyses', payload: { url: 'file:///etc/passwd' } });
    expect(scheme.statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/api/analyses' })).json()).toEqual([]);
  });

  it('executa uma análise real de ponta a ponta', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/analyses', payload: { url: `${servers.siteUrl}/flawed.html` } });
    expect(r.statusCode).toBe(202);
    analysisId = r.json().id;
    await service.queue.onIdle();
    detail = (await app.inject({ method: 'GET', url: `/api/analyses/${analysisId}` })).json();
    expect(detail.status).toBe('done');
    expect(detail.result!.scored).toBe(true);
    expect(detail.result!.scores.overall).toBeLessThan(80);
    expect(detail.result!.issues.length).toBeGreaterThan(10);
    expect(detail.result!.captures.map((c) => c.viewport)).toEqual(['desktop', 'tablet', 'mobile']);
    expect(detail.progress.find((s) => s.key === 'vision')!.state).toBe('done');
    // Pipeline de visão: OCR leu a página e o monitor confirmou o contraste medido no DOM.
    const v = detail.result!.vision;
    expect(v.modules.ocr.words).toBeGreaterThan(50);
    expect(v.modules.dom.parsed).toBe(true);
    expect(v.findings.corroborated).toBeGreaterThan(0);
    const contrast = detail.result!.issues.find((i) => i.ruleId === 'a11y.contrast')!;
    expect(contrast.corroboration).toEqual(expect.arrayContaining(['OCR', 'Imagem']));
    expect(detail.result!.issues.some((i) => i.ruleId === 'vision.dom:iframe')).toBe(true);
    expect(detail.result!.limitations.some((l) => l.includes('bloqueadas'))).toBe(true);
  }, 120_000);

  it('falha com explicação quando a página renderiza em branco, em vez de pontuar', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/analyses', payload: { url: `${servers.siteUrl}/blank.html` } });
    await service.queue.onIdle();
    const d: AnalysisDetail = (await app.inject({ method: 'GET', url: `/api/analyses/${r.json().id}` })).json();
    expect(d.status).toBe('failed');
    expect(d.overall).toBeNull();
    expect(d.error).toMatch(/sem conteúdo visível/);
    await app.inject({ method: 'DELETE', url: `/api/analyses/${d.id}` });
  }, 60_000);

  it('serve capturas e bloqueia path traversal', async () => {
    const file = detail.result!.captures[0]!.file;
    const ok = await app.inject({ method: 'GET', url: `/api/files/${analysisId}/${file}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    for (const bad of ['..%2F..%2Fui-doctor.sqlite', 'snapshots.json', '..%2Fx.jpg']) {
      expect((await app.inject({ method: 'GET', url: `/api/files/${analysisId}/${bad}` })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'GET', url: `/api/files/nao-uuid/${file}` })).statusCode).toBe(404);
  });

  it('registra problemas implementados e reflete no dashboard', async () => {
    const issue = detail.result!.issues[0]!;
    const r = await app.inject({ method: 'PATCH', url: `/api/analyses/${analysisId}/issues/${encodeURIComponent(issue.id)}`, payload: { status: 'implemented' } });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/analyses/${analysisId}/issues/inexistente`, payload: { status: 'implemented' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/analyses/${analysisId}/issues/${encodeURIComponent(issue.id)}`, payload: { status: 'x' } })).statusCode).toBe(400);
    const dash: DashboardStats = (await app.inject({ method: 'GET', url: '/api/dashboard' })).json();
    expect(dash.analyses).toBe(1);
    expect(dash.issuesImplemented).toBe(1);
    expect(dash.avgUi).toBe(detail.result!.scores.ui);
  });

  it('gera proposta antes/depois aplicando CSS e re-medindo a página real', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/analyses/${analysisId}/redesigns`, payload: { mode: 'preserve' } });
    expect(r.statusCode).toBe(202);
    await service.queue.onIdle();
    const redesign: RedesignSummary = (await app.inject({ method: 'GET', url: `/api/redesigns/${r.json().id}` })).json();
    expect(redesign.status).toBe('done');
    expect(redesign.changes.length).toBeGreaterThan(3);
    expect(redesign.after.map((c) => c.viewport)).toEqual(['desktop', 'tablet', 'mobile']);
    expect(redesign.issuesAfter!).toBeLessThan(redesign.issuesBefore!);
    expect(redesign.scoresAfter!.overall).toBeGreaterThan(redesign.scoresBefore!.overall);
    const img = await app.inject({ method: 'GET', url: `/api/files/${analysisId}/${redesign.after[0]!.file}` });
    expect(img.statusCode).toBe(200);
  }, 120_000);

  it('reformulação completa funciona por regras, sem IA', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/analyses/${analysisId}/redesigns`, payload: { mode: 'full' } });
    expect(r.statusCode).toBe(202);
    await service.queue.onIdle();
    const rd: RedesignSummary = (await app.inject({ method: 'GET', url: `/api/redesigns/${r.json().id}` })).json();
    expect(rd.status).toBe('done');
    expect(rd.mode).toBe('full');
    expect(rd.scoresAfter!.overall).toBeGreaterThan(rd.scoresBefore!.overall);
  }, 120_000);

  it('analisa imagem importada sem inventar pontuação', async () => {
    const jpg = await fs.readFile(path.join(service.analysisDir(analysisId), 'desktop-top.jpg'));
    const mp = multipart('minha-tela.jpg', jpg, 'image/jpeg');
    const r = await app.inject({ method: 'POST', url: '/api/analyses/image', payload: mp.body, headers: mp.headers });
    expect(r.statusCode).toBe(202);
    await service.queue.onIdle();
    const d: AnalysisDetail = (await app.inject({ method: 'GET', url: `/api/analyses/${r.json().id}` })).json();
    expect(d.status).toBe('done');
    // Sem IA: OCR + processamento de imagem medem a captura e a nota é atribuída.
    expect(d.result!.scored).toBe(true);
    expect(d.overall).not.toBeNull();
    expect(d.result!.unmeasured).toEqual(['responsive']);
    expect(d.result!.identity.palette.length).toBeGreaterThan(0);
    expect(d.result!.vision.modules.ocr.words).toBeGreaterThan(20);
    expect(d.result!.issues.every((i) => i.source === 'vision')).toBe(true);
    // O texto cinza da página (2.06:1) é detectado apenas pelos pixels.
    const contrast = d.result!.issues.find((i) => i.ruleId === 'vision.ocr-contrast')!;
    expect(Number(contrast.evidence[0]!.measured.ratio)).toBeLessThan(2.4);
  }, 60_000);

  it('recusa arquivos que não são imagens, independentemente do content-type', async () => {
    const mp = multipart('evil.png', Buffer.from('<svg onload=alert(1)></svg>'), 'image/png');
    const r = await app.inject({ method: 'POST', url: '/api/analyses/image', payload: mp.body, headers: mp.headers });
    expect(r.statusCode).toBe(415);
  });

  it('gerencia projetos e favoritos', async () => {
    const projects: ProjectSummary[] = (await app.inject({ method: 'GET', url: '/api/projects' })).json();
    const site = projects.find((p) => p.target.endsWith('/flawed.html'))!;
    expect(site.analysisCount).toBe(1);
    expect((await app.inject({ method: 'PATCH', url: `/api/projects/${site.id}`, payload: { favorite: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/projects/${site.id}`, payload: {} })).statusCode).toBe(400);
    const favs: ProjectSummary[] = (await app.inject({ method: 'GET', url: '/api/projects?favorites=1' })).json();
    expect(favs.map((p) => p.id)).toEqual([site.id]);
    const project = (await app.inject({ method: 'GET', url: `/api/projects/${site.id}` })).json();
    expect(project.analyses).toHaveLength(1);
  });

  it('exclui análise e seus arquivos', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/analyses/${analysisId}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/analyses/${analysisId}` })).statusCode).toBe(404);
    await expect(fs.stat(service.analysisDir(analysisId))).rejects.toThrow();
  });
});

describe('pipeline de visão substituível', () => {
  it('falha do pipeline de visão não derruba a análise: mantém os achados do DOM', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uidoctor-vf-'));
    const config = loadConfig({ UIDOCTOR_DATA_DIR: dir, UIDOCTOR_ALLOW_PRIVATE_HOSTS: `127.0.0.1:${servers.sitePort}`, UIDOCTOR_RATE_LIMIT: '100' });
    const built = await buildApp({ config, logger: false, vision: async () => { throw new Error('OCR indisponível'); } });
    const r = await built.app.inject({ method: 'POST', url: '/api/analyses', payload: { url: `${servers.siteUrl}/flawed.html` } });
    await built.service.queue.onIdle();
    const d: AnalysisDetail = (await built.app.inject({ method: 'GET', url: `/api/analyses/${r.json().id}` })).json();
    expect(d.status).toBe('done');
    expect(d.progress.find((s) => s.key === 'vision')!.state).toBe('skipped');
    expect(d.result!.vision.warnings[0]).toMatch(/OCR indisponível/);
    expect(d.result!.issues.length).toBeGreaterThan(10);
    await built.app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }, 120_000);
});
