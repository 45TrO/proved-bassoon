import type { Snapshot } from '../capture/snapshot.js';
import type { Evidence, Issue, IssueCategory, Rect, Severity, ViewportName } from '../domain/types.js';
import type { DomFacts } from './domParser.js';
import type { Raster } from './imageOps.js';
import type { OcrResult } from './ocr.js';
import type { ComponentVariant, DetectedButton } from './patterns.js';

/** Uma imagem analisada pelos módulos de visão. Todas as coordenadas estão no espaço da captura original. */
export interface ImageFacts {
  viewport: ViewportName | 'image';
  width: number;
  height: number;
  /** Altura da primeira dobra (área visível sem rolar). */
  fold: number;
  /** Fator de densidade de pixels estimado (imagens importadas de telas retina). */
  dpr: number;
  raster: Raster;
  ocr: OcrResult;
  blocks: Rect[];
  edgeDensityFold: number;
  foregroundFold: number;
  buttons: DetectedButton[];
  fields: number;
  nav: { count: number; rect: Rect | null; items: string[] };
}

export interface Facts {
  source: 'url' | 'image';
  images: ImageFacts[];
  snapshots: Partial<Record<ViewportName, Snapshot>>;
  dom: DomFacts | null;
  variants: ComponentVariant[];
  /** Problemas já medidos pelo motor de regras sobre o DOM. */
  ruleIssues: Issue[];
}

/** Proposta de um achado, ainda sujeita ao monitor. */
export interface Candidate {
  rule: string;
  category: IssueCategory;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  evidence: Evidence[];
  occurrences?: number;
  /** 0..1, combinando confiança do OCR, uniformidade do fundo etc. */
  confidence: number;
  modules: ('OCR' | 'Imagem' | 'Padrões' | 'DOM')[];
}

export interface VisionRule {
  id: string;
  /** Em quais origens a regra se aplica. */
  sources: ('url' | 'image')[];
  run(f: Facts): Candidate[];
}

export const toRaster = (r: Rect, scale: number): Rect => ({ x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale });

export function iou(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** Fração de `a` contida em `b`. */
export function containment(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return a.width * a.height > 0 ? inter / (a.width * a.height) : 0;
}

export const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
