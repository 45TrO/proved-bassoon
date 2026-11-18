import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Snapshot } from '../capture/snapshot.js';
import type { Issue, ViewportName, VisionReport } from '../domain/types.js';
import { parseDom, type DomFacts } from './domParser.js';
import { iou, type Facts, type ImageFacts } from './facts.js';
import { darkRatio, density, edgeMask, grayscale, loadRaster, sobel, xyCut } from './imageOps.js';
import { monitor } from './monitor.js';
import { OCR_LANGUAGES, recognize } from './ocr.js';
import { detectButtons, detectNavItems, findComponentVariants } from './patterns.js';
import { VISION_RULES } from './rules.js';

export interface VisionImageInput {
  viewport: ViewportName | 'image';
  file: string;
  /** Altura da primeira dobra no espaço da captura (viewport.height para URLs). */
  fold?: number;
}

export interface VisionInput {
  source: 'url' | 'image';
  dir: string;
  dataDir: string;
  images: VisionImageInput[];
  snapshots: Partial<Record<ViewportName, Snapshot>>;
  ruleIssues: Issue[];
  htmlFile?: string;
}

export interface VisionOutput {
  issues: Issue[];
  report: VisionReport;
  /** Componentes reconhecidos por imagem (diagnóstico e testes). */
  detected: { viewport: string; buttons: { text: string; fill: string; rect: { x: number; y: number; width: number; height: number } }[]; nav: string[] }[];
}

/** Densidade de pixels provável de uma captura importada (telas retina geram imagens 2× ou 3×). */
export function estimateDpr(width: number): number {
  if (width >= 2400) return 2;
  if (width >= 1000 && width < 1300) return 3; // celular 375–414 pt em 3×
  if (width >= 700 && width < 1000) return 2; // celular em 2×
  return 1;
}

function defaultFold(width: number, height: number, dpr: number): number {
  const cssW = width / dpr;
  const ratio = cssW < 700 ? 2.16 : 0.625; // retrato de celular vs. desktop 16:10
  return Math.min(height, width * ratio);
}

async function analyzeImage(input: VisionImageInput, v: VisionInput, timings: { ocr: number; image: number }, source: 'url' | 'image'): Promise<ImageFacts> {
  const file = path.join(v.dir, input.file);
  const started = Date.now();
  // Raster para processamento: largura até 1600 px (imagens maiores são reduzidas).
  const raster = await loadRaster(file, { maxWidth: 1600, maxHeight: 5000 });
  const meta = await sharp(file).metadata();
  const width = meta.width ?? raster.width;
  const height = Math.min(meta.height ?? raster.height, Math.round(5000 / raster.scale));
  const dpr = source === 'image' ? estimateDpr(width) : 1;
  const fold = input.fold ?? defaultFold(width, height, dpr);

  const gray = grayscale(raster);
  const mask = edgeMask(sobel(gray, raster.width, raster.height));
  const foldR = { x: 0, y: 0, width: raster.width, height: Math.min(raster.height, Math.round(fold * raster.scale)) };
  const edgeDensityFold = density(mask, raster.width, foldR);
  const blocksR = xyCut(mask, raster.width, raster.height, { minGap: Math.max(8, Math.round(14 * raster.scale)) });
  const blocks = blocksR.map((b) => ({ x: b.x / raster.scale, y: b.y / raster.scale, width: b.width / raster.scale, height: b.height / raster.scale }));
  const foldArea = width * fold;
  const fgArea = blocks.filter((b) => b.y < fold).reduce((a, b) => a + b.width * (Math.min(b.y + b.height, fold) - b.y), 0);
  timings.image += Date.now() - started;

  // OCR sobre a imagem reduzida (PNG sem perdas); coordenadas voltam para o espaço original.
  const rawImg = () => sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 3 } });
  // CLAHE (equalização adaptativa de histograma) realça texto de baixo contraste, que a
  // binarização do Tesseract descartaria — justamente o texto que mais interessa medir.
  // As cores continuam sendo medidas nos pixels originais.
  const ocr = await recognize(v.dataDir, await rawImg().grayscale().clahe({ width: 48, height: 48, maxSlope: 6 }).png().toBuffer(), raster.scale);
  timings.ocr += ocr.durationMs;
  // Texto claro sobre fundo escuro escapa do Tesseract: com áreas escuras relevantes,
  // uma segunda passada sobre a imagem invertida acrescenta as linhas que faltaram.
  if (darkRatio(raster) > 0.12) {
    const inv = await recognize(v.dataDir, await rawImg().negate().png().toBuffer(), raster.scale);
    timings.ocr += inv.durationMs;
    for (const line of inv.lines) {
      if (line.confidence < 70 || ocr.lines.some((l) => iou(l.box, line.box) > 0.2)) continue;
      ocr.lines.push(line);
      ocr.words += line.words.length;
    }
  }

  const ocrStarted = Date.now();
  const buttonsR = await detectButtons(raster, dpr, async (png) => {
    const res = await recognize(v.dataDir, png, 1, 'line');
    const words = res.lines.flatMap((l) => l.words);
    return { text: words.map((w) => w.text).join(' '), confidence: res.meanConfidence ?? 0 };
  });
  timings.ocr += Date.now() - ocrStarted;
  const buttons = buttonsR.filter((b) => b.kind === 'button').map((b) => ({ ...b, rect: { x: b.rect.x / raster.scale, y: b.rect.y / raster.scale, width: b.rect.width / raster.scale, height: b.rect.height / raster.scale } }));
  const nav = detectNavItems(ocr.lines, Math.min(160 * dpr, fold * 0.25));

  const fields = buttonsR.filter((b) => b.kind === 'field').length;
  return { viewport: input.viewport, width, height, fold, dpr, raster, ocr, blocks, edgeDensityFold, foregroundFold: foldArea ? Math.min(1, fgArea / foldArea) : 0, buttons, fields, nav };
}

/**
 * Pipeline de visão determinístico (substitui a IA):
 * imagem → OCR → padrões → DOM estático → regras → monitor.
 */
export async function runVision(v: VisionInput): Promise<VisionOutput> {
  const timings = { ocr: 0, image: 0 };
  const warnings: string[] = [];
  const images: ImageFacts[] = [];
  for (const input of v.images) {
    try {
      images.push(await analyzeImage(input, v, timings, v.source));
    } catch (err) {
      warnings.push(`Imagem ${input.viewport} não processada: ${(err as Error).message}`);
    }
  }

  let dom: DomFacts | null = null;
  if (v.htmlFile) {
    try {
      dom = parseDom(await fs.readFile(path.join(v.dir, v.htmlFile), 'utf8'));
    } catch (err) {
      warnings.push(`HTML não analisado: ${(err as Error).message}`);
    }
  }
  const variants = v.snapshots.desktop ? findComponentVariants(v.snapshots.desktop.elements) : { groups: 0, variants: [] };

  const facts: Facts = { source: v.source, images, snapshots: v.snapshots, dom, variants: variants.variants, ruleIssues: v.ruleIssues };
  const rules = VISION_RULES.filter((r) => r.sources.includes(v.source));
  const candidates = [];
  let fired = 0;
  for (const rule of rules) {
    try {
      const out = rule.run(facts);
      if (out.length) fired++;
      candidates.push(...out);
    } catch (err) {
      warnings.push(`Regra ${rule.id} falhou: ${(err as Error).message}`);
    }
  }
  const result = monitor(candidates, facts);

  // Coerência entre módulos: DOM com muito texto e OCR sem leitura indica captura problemática.
  const domWords = v.snapshots.desktop?.elements.reduce((a, e) => a + (e.ownText ? e.words : 0), 0) ?? 0;
  const ocrWords = images.reduce((a, i) => a + i.ocr.words, 0);
  if (v.source === 'url' && domWords > 50 && ocrWords < 5) warnings.push('O OCR leu pouco texto apesar de o DOM ter conteúdo; regras baseadas em pixels podem estar subestimadas.');

  const confs = images.map((i) => i.ocr.meanConfidence).filter((c): c is number => c !== null);
  const report: VisionReport = {
    modules: {
      ocr: {
        words: ocrWords,
        lines: images.reduce((a, i) => a + i.ocr.lines.length, 0),
        meanConfidence: confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : null,
        durationMs: timings.ocr,
        languages: [...OCR_LANGUAGES],
      },
      image: {
        blocks: images.reduce((a, i) => a + i.blocks.length, 0),
        edgeDensity: images[0] ? Math.round(images[0].edgeDensityFold * 1000) / 1000 : null,
        foregroundRatio: images[0] ? Math.round(images[0].foregroundFold * 100) / 100 : null,
        durationMs: timings.image,
      },
      patterns: {
        buttons: images.reduce((a, i) => a + i.buttons.length, 0),
        fields: images.reduce((a, i) => a + i.fields, 0),
        navItems: Math.max(0, ...images.map((i) => i.nav.count)),
        componentGroups: variants.groups,
      },
      dom: { parsed: dom !== null, checks: dom ? 11 : 0 },
    },
    rules: { evaluated: rules.length, fired },
    findings: result.counts,
    trace: result.trace.slice(0, 200),
    warnings,
  };
  const detected = images.map((i) => ({ viewport: String(i.viewport), buttons: i.buttons.map((b) => ({ text: b.text, fill: b.fill, rect: b.rect })), nav: i.nav.items }));
  return { issues: result.accepted, report, detected };
}

export function emptyVisionReport(warning?: string): VisionReport {
  return {
    modules: {
      ocr: { words: 0, lines: 0, meanConfidence: null, durationMs: 0, languages: [...OCR_LANGUAGES] },
      image: { blocks: 0, edgeDensity: null, foregroundRatio: null, durationMs: 0 },
      patterns: { buttons: 0, fields: 0, navItems: 0, componentGroups: 0 },
      dom: { parsed: false, checks: 0 },
    },
    rules: { evaluated: 0, fired: 0 },
    findings: { accepted: 0, rejected: 0, corroborated: 0, downgraded: 0 },
    trace: [],
    warnings: warning ? [warning] : [],
  };
}
