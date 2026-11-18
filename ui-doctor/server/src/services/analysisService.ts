import fs from 'node:fs/promises';
import path from 'node:path';
import { runRules } from '../analysis/engine.js';
import { identityFromPixels } from '../analysis/identity.js';
import { computeScores, sortIssues } from '../analysis/scoring.js';
import { captureUrl, CaptureError } from '../capture/capture.js';
import { analyzeImagePixels, sniffImage } from '../capture/imageAnalysis.js';
import type { Snapshot } from '../capture/snapshot.js';
import type { AppConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { AnalysisResult, Issue, IssueCategory, RedesignChange, RedesignMode, ViewportName } from '../domain/types.js';
import { JobQueue } from '../jobs/queue.js';
import { IMAGE_STEPS, Progress, URL_STEPS } from '../jobs/progress.js';
import { sanitizeCss } from '../redesign/cssSanitizer.js';
import { buildHarmonization } from '../redesign/harmonize.js';
import { buildDeterministicFixes } from '../redesign/fixes.js';
import { assertSafeUrl, UrlRejectedError } from '../security/urlGuard.js';
import { emptyVisionReport, runVision, type VisionInput, type VisionOutput } from '../vision/engine.js';

/** Pipeline de visão injetável (testes podem substituir por um falso). */
export type VisionRunner = (input: VisionInput) => Promise<VisionOutput>;

type Snapshots = Partial<Record<ViewportName, Snapshot>>;

export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export class AnalysisService {
  readonly queue: JobQueue;

  constructor(
    private readonly config: AppConfig,
    private readonly repo: Repository,
    private readonly vision: VisionRunner = runVision,
  ) {
    this.queue = new JobQueue(config.concurrency);
  }

  analysisDir(id: string): string {
    return path.join(this.config.dataDir, 'analyses', id);
  }

  // ------------------------------------------------------------------ URL
  async startUrlAnalysis(rawUrl: string): Promise<string> {
    let target: Awaited<ReturnType<typeof assertSafeUrl>>;
    try {
      target = await assertSafeUrl(rawUrl, { allowPrivate: this.config.allowPrivateHosts });
    } catch (err) {
      if (err instanceof UrlRejectedError) throw new ServiceError(err.message, 422, err.code);
      throw err;
    }
    const url = target.url.toString();
    const project = this.repo.upsertProject('url', url);
    const progress = new Progress(URL_STEPS);
    progress.done('validate', `${target.host} → ${target.address}`);
    const id = this.repo.createAnalysis(project.id, 'url', url, progress.snapshot());
    this.queue.push(() => this.runUrlAnalysis(id, url, progress));
    return id;
  }

  private async runUrlAnalysis(id: string, url: string, progress: Progress) {
    const started = Date.now();
    const dir = this.analysisDir(id);
    const save = (status: Parameters<Repository['setStatus']>[1]) => this.repo.setStatus(id, status, progress.snapshot());
    try {
      await fs.mkdir(dir, { recursive: true });
      progress.start('capture', 'Iniciando navegador isolado');
      save('capturing');
      const capture = await captureUrl({
        url,
        outDir: dir,
        config: this.config,
        topCrops: true,
        saveHtml: true,
        onViewport: (vp, phase) => {
          if (phase === 'start') {
            progress.detail('capture', `Renderizando ${vp}`);
            save('capturing');
          }
        },
      });
      progress.done('capture', `${capture.captures.length} resoluções capturadas`);

      // Página sem conteúdo visível não pode ser avaliada: falhar é mais honesto que pontuar.
      const visibleCount = Math.max(...Object.values(capture.snapshots).map((s) => s?.elements.filter((e) => !e.hidden).length ?? 0));
      const words = Math.max(...Object.values(capture.snapshots).map((s) => s?.elements.reduce((a, e) => a + (e.ownText ? e.words : 0), 0) ?? 0));
      if (visibleCount < 3 || (visibleCount < 8 && words === 0)) {
        throw new CaptureError(
          capture.jsErrors > 0
            ? `A página carregou sem conteúdo visível e registrou ${capture.jsErrors} erro(s) de JavaScript. Não há o que medir; verifique se o site funciona fora do navegador do usuário logado.`
            : 'A página carregou sem conteúdo visível (pode exigir login, depender de recursos bloqueados ou renderizar só após interação). Não há o que medir.',
          'unreachable',
        );
      }

      progress.start('rules', 'Executando regras de diagnóstico');
      save('analyzing');
      const snapshots = capture.snapshots;
      await fs.writeFile(path.join(dir, 'snapshots.json'), JSON.stringify(snapshots));
      const rules = runRules(snapshots);
      progress.done('rules', `${rules.issues.length} problemas com evidência`);

      const limitations: string[] = [];
      for (const f of capture.failedViewports) limitations.push(`Viewport ${f.viewport} não capturado: ${f.reason}`);
      if (Object.values(snapshots).some((s) => s?.truncated)) limitations.push('Página muito grande: apenas os primeiros 2.500 elementos visíveis foram analisados.');
      const tallest = capture.captures.find((c) => (c.documentHeight ?? 0) > c.fullHeight);
      if (tallest) limitations.push(`Captura limitada a ${tallest.fullHeight}px de altura (página tem ${tallest.documentHeight}px).`);
      if (capture.blocked.length) limitations.push(`${capture.blocked.length} requisições da página foram bloqueadas pela política de segurança (rede interna, portas ou limites).`);
      for (const e of rules.errors) limitations.push(`Regra com falha: ${e}`);
      if (capture.jsErrors) limitations.push(`A página registrou ${capture.jsErrors} erro(s) de JavaScript durante a captura; partes da interface podem não ter sido renderizadas.`);

      progress.start('vision', 'OCR, processamento de imagem, padrões e parsing de DOM');
      save('analyzing');
      let issues: Issue[] = rules.issues;
      let vision = emptyVisionReport();
      try {
        const out = await this.vision({
          source: 'url',
          dir,
          dataDir: this.config.dataDir,
          images: capture.topCrops.map((t) => ({ viewport: t.viewport, file: t.file, fold: snapshots[t.viewport]?.viewport.height })),
          snapshots,
          ruleIssues: rules.issues,
          htmlFile: 'desktop.html',
        });
        issues = sortIssues([...rules.issues, ...out.issues]);
        vision = out.report;
        progress.done('vision', `${out.report.modules.ocr.words} palavras lidas · ${out.issues.length} achados aceitos · ${out.report.findings.corroborated} confirmações · ${out.report.findings.rejected} rejeitados`);
      } catch (err) {
        vision = emptyVisionReport(`Pipeline de visão indisponível: ${(err as Error).message}`);
        progress.skip('vision', 'Falhou — relatório mantém os achados medidos no DOM');
      }

      progress.start('score');
      const scores = computeScores(issues);
      const els = Object.values(snapshots)[0];
      const result: AnalysisResult = {
        scored: true,
        scores,
        issues,
        captures: capture.captures,
        identity: rules.identity,
        metrics: {
          elementsAnalyzed: Object.values(snapshots).reduce((a, s) => a + (s?.elements.length ?? 0), 0),
          interactiveElements: els?.elements.filter((e) => e.interactive).length ?? 0,
          forms: els?.forms.length ?? 0,
          images: els?.elements.filter((e) => e.tag === 'img').length ?? 0,
          wordsAboveFold: els ? els.elements.filter((e) => e.ownText && e.y < els.viewport.height).reduce((a, e) => a + e.words, 0) : 0,
          durationMs: Date.now() - started,
        },
        vision,
        page: { title: capture.title, finalUrl: capture.finalUrl, lang: els?.lang ?? null },
        limitations,
      };
      progress.done('score', `Nota geral ${scores.overall}`);
      this.repo.completeAnalysis(id, result, progress.snapshot(), capture.captures[0]?.file ?? null);
    } catch (err) {
      const message = err instanceof CaptureError ? err.message : `Falha inesperada na análise: ${(err as Error).message}`;
      progress.fail(message);
      this.repo.failAnalysis(id, message, progress.snapshot());
    }
  }

  // ---------------------------------------------------------------- IMAGEM
  async startImageAnalysis(filename: string, data: Buffer): Promise<string> {
    const mime = sniffImage(data);
    if (!mime) throw new ServiceError('Formato não suportado. Envie PNG, JPEG ou WebP.', 415, 'unsupported_media');
    const safeName = filename.replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'captura';
    const project = this.repo.upsertProject('image', `${safeName}#${Date.now().toString(36)}`, safeName.replace(/\.[a-z0-9]+$/i, ''));
    const progress = new Progress(IMAGE_STEPS);
    progress.done('validate', `${mime.split('/')[1]!.toUpperCase()} · ${(data.length / 1024).toFixed(0)} KB`);
    const id = this.repo.createAnalysis(project.id, 'image', safeName, progress.snapshot());
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const dir = this.analysisDir(id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `image.${ext}`), data);
    this.queue.push(() => this.runImageAnalysis(id, `image.${ext}`, data, mime, progress));
    return id;
  }

  private async runImageAnalysis(id: string, file: string, data: Buffer, mime: 'image/png' | 'image/jpeg' | 'image/webp', progress: Progress) {
    const started = Date.now();
    const dir = this.analysisDir(id);
    try {
      progress.start('pixels');
      this.repo.setStatus(id, 'analyzing', progress.snapshot());
      const stats = await analyzeImagePixels(data, mime, this.config);
      const identity = identityFromPixels(stats.colors);
      progress.done('pixels', `${stats.width}×${stats.height}px · ${identity.palette.length} cores dominantes`);

      progress.start('vision', 'OCR, segmentação e reconhecimento de componentes');
      this.repo.setStatus(id, 'analyzing', progress.snapshot());
      const out = await this.vision({ source: 'image', dir, dataDir: this.config.dataDir, images: [{ viewport: 'image', file }], snapshots: {}, ruleIssues: [] });
      const issues = sortIssues(out.issues);
      progress.done('vision', `${out.report.modules.ocr.words} palavras lidas · ${out.report.modules.patterns.buttons} botões reconhecidos · ${issues.length} achados aceitos`);

      const limitations = [
        'Imagem importada não tem DOM: semântica, formulários e acessibilidade por código não podem ser verificados. Responsividade não é medida (uma única resolução).',
        ...out.report.warnings,
      ];
      const readable = out.report.modules.ocr.words >= 5;
      if (!readable) limitations.push('O OCR leu pouco texto nesta imagem; a nota considera apenas o que pôde ser medido nos pixels.');

      progress.start('score');
      const measured: IssueCategory[] = ['visual', 'ux', 'accessibility', 'identity'];
      const result: AnalysisResult = {
        scored: true,
        scores: computeScores(issues, measured),
        unmeasured: ['responsive'],
        issues,
        captures: [{ viewport: 'image', width: stats.width, height: stats.height, fullHeight: stats.height, file }],
        identity,
        metrics: { elementsAnalyzed: out.report.modules.image.blocks, interactiveElements: out.report.modules.patterns.buttons, forms: 0, images: 1, wordsAboveFold: out.report.modules.ocr.words, durationMs: Date.now() - started },
        vision: out.report,
        page: { title: file, finalUrl: '', lang: null },
        limitations,
      };
      progress.done('score', `Nota geral ${result.scores.overall}`);
      this.repo.completeAnalysis(id, result, progress.snapshot(), file);
    } catch (err) {
      const message = `Não foi possível processar a imagem: ${(err as Error).message}`;
      progress.fail(message);
      this.repo.failAnalysis(id, message, progress.snapshot());
    }
  }

  // -------------------------------------------------------------- REDESIGN
  startRedesign(analysisId: string, mode: RedesignMode): string {
    const analysis = this.repo.getAnalysis(analysisId);
    if (!analysis) throw new ServiceError('Análise não encontrada.', 404, 'not_found');
    if (analysis.status !== 'done' || !analysis.result) throw new ServiceError('A análise ainda não foi concluída.', 409, 'not_ready');
    if (analysis.sourceType !== 'url') {
      throw new ServiceError('A proposta visual com recaptura está disponível para análises por URL.', 422, 'unsupported_source');
    }
    const id = this.repo.createRedesign(analysisId, mode);
    this.queue.push(() => this.runRedesign(id, analysisId, mode));
    return id;
  }

  private async runRedesign(id: string, analysisId: string, mode: RedesignMode) {
    const analysis = this.repo.getAnalysis(analysisId)!;
    const result = analysis.result!;
    const dir = this.analysisDir(analysisId);
    try {
      this.repo.updateRedesign(id, 'running');
      const snapshots = JSON.parse(await fs.readFile(path.join(dir, 'snapshots.json'), 'utf8')) as Snapshots;
      const ruleIssues = result.issues.filter((i) => i.source === 'rules' && i.status !== 'dismissed');
      // Ambos os modos aplicam as correções; a reformulação completa também harmoniza o sistema visual.
      const fixes = buildDeterministicFixes(ruleIssues, snapshots);
      const changes: RedesignChange[] = [...fixes.changes];
      let css = fixes.css;
      let note: string | null = null;
      if (mode === 'full') {
        const harmony = buildHarmonization(snapshots);
        changes.push(...harmony.changes);
        if (harmony.css) css = `${css}\n\n${harmony.css}`;
        if (harmony.changes.length === 0) note = 'Nenhuma variante acidental, cor quase duplicada ou família tipográfica excedente foi encontrada para harmonizar.';
      }
      const clean = sanitizeCss(css);
      css = clean.css;
      if (clean.removed) note = `${clean.removed} construções inseguras foram removidas do CSS.`;
      if (changes.length === 0) {
        note = note ?? 'Nenhuma correção automática se aplica aos problemas desta análise; as recomendações exigem mudanças de conteúdo ou estrutura.';
      }

      const capture = await captureUrl({ url: analysis.target, outDir: dir, config: this.config, injectCss: css, filePrefix: `redesign-${id}-` });
      const after = runRules(capture.snapshots);
      const scoresBefore = computeScores(ruleIssues);
      const scoresAfter = computeScores(after.issues);
      this.repo.updateRedesign(id, 'done', {
        changes,
        css,
        before: result.captures,
        after: capture.captures,
        scoresBefore,
        scoresAfter,
        issuesBefore: ruleIssues.length,
        issuesAfter: after.issues.length,
        note,
      });
    } catch (err) {
      const message = err instanceof CaptureError ? err.message : `Falha ao gerar a proposta: ${(err as Error).message}`;
      this.repo.updateRedesign(id, 'failed', undefined, message);
    }
  }
}
