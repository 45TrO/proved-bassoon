import { deltaE2000, parseColor, rgbToHsl, rgbToLab, toHex, type RGBA } from '../analysis/color.js';
import type { SnapEl } from '../capture/snapshot.js';
import type { Rect } from '../domain/types.js';
import { findSurfaces, labelCrop, type Raster } from './imageOps.js';
import type { OcrLine } from './ocr.js';

export interface DetectedButton {
  rect: Rect;
  fill: string;
  text: string;
  confidence: number;
  /** Superfície quase branca e neutra com texto = campo de formulário (placeholder), não botão. */
  kind: 'button' | 'field';
}

/**
 * Reconhece controles preenchidos (botões, selos) em duas etapas:
 *  1. forma: superfícies retangulares de cor uniforme que se destacam do entorno
 *     (componentes conexos, ver findSurfaces);
 *  2. conteúdo: o rótulo é lido por OCR no recorte normalizado da superfície
 *     (polaridade invertida quando o fundo é escuro).
 * Superfícies sem texto legível (faixas decorativas, imagens) são descartadas.
 * Coordenadas no espaço do raster.
 */
export async function detectButtons(
  r: Raster,
  dpr: number,
  readLabel: (png: Buffer) => Promise<{ text: string; confidence: number }>,
): Promise<DetectedButton[]> {
  const unit = dpr * r.scale;
  const surfaces = findSurfaces(r, { minHeight: 18 * unit, maxHeight: 80 * unit })
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .slice(0, 40);
  const out: DetectedButton[] = [];
  for (const s of surfaces) {
    const label = await readLabel(await labelCrop(r, s.rect, s.fill));
    const text = label.text.replace(/\s+/g, ' ').trim();
    const letters = text.replace(/[^\p{L}]/gu, '').length;
    if (letters < 2 || label.confidence < 60 || text.split(' ').length > 5) continue;
    const hsl = rgbToHsl(s.fill);
    const kind = hsl.l > 0.9 && hsl.s < 0.5 ? 'field' : 'button';
    out.push({ rect: s.rect, fill: toHex(s.fill), text, confidence: label.confidence, kind });
  }
  return out;
}

/**
 * Reconhece uma barra de navegação: na faixa superior, uma linha com vários
 * rótulos curtos separados por espaços regulares.
 */
export function detectNavItems(lines: OcrLine[], bandHeight: number): { count: number; rect: Rect | null; items: string[] } {
  const top = lines.filter((l) => l.box.y < bandHeight);
  let best: { count: number; rect: Rect | null; items: string[] } = { count: 0, rect: null, items: [] };
  // Agrupa palavras da faixa superior por altura (mesma linha visual).
  const words = top.flatMap((l) => l.words).filter((w) => w.confidence >= 60 && w.text.length <= 18);
  const rows: (typeof words)[] = [];
  for (const w of words.sort((a, b) => a.box.y - b.box.y)) {
    const row = rows.find((r) => Math.abs(r[0]!.box.y - w.box.y) < 6);
    if (row) row.push(w);
    else rows.push([w]);
  }
  for (const row of rows) {
    const sorted = row.sort((a, b) => a.box.x - b.box.x);
    // Itens separados por vãos ≥ 12 px; palavras coladas formam um mesmo item.
    const items: { text: string; x0: number; x1: number }[] = [];
    for (const w of sorted) {
      const last = items[items.length - 1];
      if (last && w.box.x - last.x1 < 10) {
        last.text += ` ${w.text}`;
        last.x1 = w.box.x + w.box.width;
      } else items.push({ text: w.text, x0: w.box.x, x1: w.box.x + w.box.width });
    }
    // A logomarca costuma ficar isolada por um vão muito maior: separa clusters por vãos > 3× a mediana.
    const gaps = items.slice(1).map((it, i) => it.x0 - items[i]!.x1);
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
    const clusters: (typeof items)[] = [[]];
    items.forEach((it, i) => {
      if (i > 0 && median > 0 && gaps[i - 1]! > median * 3) clusters.push([]);
      clusters[clusters.length - 1]!.push(it);
    });
    const main = clusters.sort((a, b) => b.length - a.length)[0]!;
    items.splice(0, items.length, ...main);
    if (items.length > best.count && items.length >= 3) {
      const ys = row.map((w) => w.box.y);
      const hs = row.map((w) => w.box.y + w.box.height);
      best = {
        count: items.length,
        items: items.map((i) => i.text),
        rect: { x: items[0]!.x0, y: Math.min(...ys), width: items[items.length - 1]!.x1 - items[0]!.x0, height: Math.max(...hs) - Math.min(...ys) },
      };
    }
  }
  return best;
}

export interface ComponentVariant {
  kind: string;
  dominant: { signature: string; count: number; example: SnapEl };
  outlier: SnapEl;
  differences: string[];
}

interface Signature {
  radius: number;
  height: number;
  fontSize: number;
  fontWeight: number;
  bg: RGBA | null;
}

function signatureOf(e: SnapEl): Signature {
  const bg = parseColor(e.ownBg);
  return { radius: e.radius, height: Math.round(e.h), fontSize: Math.round(e.fontSize), fontWeight: e.fontWeight, bg: bg && bg.a > 0.5 ? bg : null };
}

function describe(s: Signature): string {
  return `raio ${s.radius}px · altura ${s.height}px · fonte ${s.fontSize}px/${s.fontWeight}${s.bg ? ` · fundo ${toHex(s.bg)}` : ''}`;
}

/**
 * Agrupa componentes do mesmo tipo por assinatura visual e aponta "variantes
 * acidentais": elementos isolados quase idênticos a um grupo dominante, que
 * diferem em poucos pixels ou num tom de cor. Diferenças grandes são tratadas
 * como variantes intencionais e não são apontadas.
 */
export function findComponentVariants(elements: SnapEl[]): { groups: number; variants: ComponentVariant[] } {
  const kinds: Record<string, SnapEl[]> = {
    botão: elements.filter((e) => !e.hidden && e.kind === 'button' && e.h >= 16 && e.h <= 80),
    campo: elements.filter((e) => !e.hidden && (e.kind === 'input' || e.kind === 'select') && !['checkbox', 'radio', 'hidden'].includes(e.inputType ?? '')),
  };
  const variants: ComponentVariant[] = [];
  let groups = 0;
  for (const [kind, els] of Object.entries(kinds)) {
    if (els.length < 3) continue;
    const bySig = new Map<string, { sig: Signature; els: SnapEl[] }>();
    for (const e of els) {
      const sig = signatureOf(e);
      const key = `${sig.radius}|${sig.height}|${sig.fontSize}|${sig.fontWeight}|${sig.bg ? toHex(sig.bg) : '-'}`;
      const g = bySig.get(key) ?? { sig, els: [] };
      g.els.push(e);
      bySig.set(key, g);
    }
    groups += bySig.size;
    const sorted = [...bySig.values()].sort((a, b) => b.els.length - a.els.length);
    const dominant = sorted[0]!;
    if (dominant.els.length < 2) continue;
    for (const g of sorted.slice(1)) {
      if (g.els.length > 1) continue; // variantes repetidas são intencionais
      const a = dominant.sig;
      const b = g.sig;
      const diffs: string[] = [];
      let accidental = true;
      const near = (x: number, y: number, tol: number, label: string) => {
        if (x === y) return;
        if (Math.abs(x - y) <= tol) diffs.push(`${label} ${y}px em vez de ${x}px`);
        else accidental = false;
      };
      near(a.radius, b.radius, 3, 'raio');
      near(a.height, b.height, 4, 'altura');
      near(a.fontSize, b.fontSize, 1, 'fonte');
      if (a.fontWeight !== b.fontWeight) accidental = false;
      if (a.bg && b.bg) {
        const d = deltaE2000(rgbToLab(a.bg), rgbToLab(b.bg));
        if (d > 0.5 && d < 6) diffs.push(`fundo ${toHex(b.bg)} em vez de ${toHex(a.bg)}`);
        else if (d >= 6) accidental = false;
      } else if (Boolean(a.bg) !== Boolean(b.bg)) accidental = false;
      if (accidental && diffs.length > 0) {
        variants.push({ kind, dominant: { signature: describe(a), count: dominant.els.length, example: dominant.els[0]! }, outlier: g.els[0]!, differences: diffs });
      }
    }
  }
  return { groups, variants };
}
