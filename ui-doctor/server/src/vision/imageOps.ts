import sharp from 'sharp';
import { contrastRatio, deltaE2000, rgbToLab, toHex, type RGBA } from '../analysis/color.js';
import type { Rect } from '../domain/types.js';

/** Imagem RGB em memória (3 bytes por pixel). */
export interface Raster {
  width: number;
  height: number;
  data: Buffer;
  /** Fator aplicado ao reduzir a imagem (coordenadas originais = coordenadas × 1/scale). */
  scale: number;
}

export async function loadRaster(file: string | Buffer, opts: { maxWidth?: number; maxHeight?: number } = {}): Promise<Raster> {
  const img = sharp(file, { limitInputPixels: 80_000_000 }).rotate();
  const meta = await img.metadata();
  const w0 = meta.width ?? 0;
  const h0 = meta.height ?? 0;
  if (!w0 || !h0) throw new Error('imagem sem dimensões');
  const scale = Math.min(1, (opts.maxWidth ?? w0) / w0, (opts.maxHeight ?? h0) / h0);
  const pipeline = scale < 1 ? img.resize(Math.round(w0 * scale), Math.round(h0 * scale), { kernel: 'lanczos3' }) : img;
  const { data, info } = await pipeline.removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data, scale };
}

export function px(r: Raster, x: number, y: number): RGBA {
  const i = (y * r.width + x) * 3;
  return { r: r.data[i]!, g: r.data[i + 1]!, b: r.data[i + 2]!, a: 1 };
}

export function grayscale(r: Raster): Float32Array {
  const g = new Float32Array(r.width * r.height);
  for (let i = 0, j = 0; i < g.length; i++, j += 3) g[i] = 0.299 * r.data[j]! + 0.587 * r.data[j + 1]! + 0.114 * r.data[j + 2]!;
  return g;
}

/** Magnitude do gradiente de Sobel (0..~1440). */
export function sobel(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1]!, t = gray[i - w]!, tr = gray[i - w + 1]!;
      const l = gray[i - 1]!, r = gray[i + 1]!;
      const bl = gray[i + w - 1]!, b = gray[i + w]!, br = gray[i + w + 1]!;
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

export const EDGE_THRESHOLD = 60;

export function edgeMask(mag: Float32Array, threshold = EDGE_THRESHOLD): Uint8Array {
  const m = new Uint8Array(mag.length);
  for (let i = 0; i < mag.length; i++) m[i] = mag[i]! > threshold ? 1 : 0;
  return m;
}

/** Fração de pixels de borda numa região (medida de "congestionamento visual"). */
export function density(mask: Uint8Array, w: number, rect: Rect): number {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(w, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(mask.length / w, Math.ceil(rect.y + rect.height));
  let on = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    on += mask[y * w + x]!;
    total++;
  }
  return total ? on / total : 0;
}

/**
 * Segmentação XY-cut recursiva: corta a região em faixas de espaço vazio
 * (linhas/colunas sem bordas) alternando eixos. Produz os blocos de conteúdo.
 */
export function xyCut(mask: Uint8Array, w: number, h: number, opts: { minGap?: number; minSize?: number; maxDepth?: number } = {}): Rect[] {
  const minGap = opts.minGap ?? 14;
  const minSize = opts.minSize ?? 6;
  const maxDepth = opts.maxDepth ?? 8;
  const out: Rect[] = [];

  const profile = (r: Rect, axis: 'x' | 'y') => {
    const len = axis === 'y' ? r.height : r.width;
    const p = new Uint32Array(len);
    for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
      if (mask[y * w + x]) p[axis === 'y' ? y - r.y : x - r.x]!++;
    }
    return p;
  };

  const trim = (r: Rect): Rect | null => {
    const py = profile(r, 'y');
    const px2 = profile(r, 'x');
    let top = 0, bottom = py.length - 1, left = 0, right = px2.length - 1;
    while (top <= bottom && py[top] === 0) top++;
    while (bottom >= top && py[bottom] === 0) bottom--;
    while (left <= right && px2[left] === 0) left++;
    while (right >= left && px2[right] === 0) right--;
    if (top > bottom || left > right) return null;
    return { x: r.x + left, y: r.y + top, width: right - left + 1, height: bottom - top + 1 };
  };

  const split = (r: Rect, axis: 'x' | 'y'): Rect[] => {
    const p = profile(r, axis);
    const parts: Rect[] = [];
    let start = -1;
    let gap = 0;
    for (let i = 0; i <= p.length; i++) {
      const filled = i < p.length && p[i]! > 0;
      if (filled) {
        if (start === -1) start = i;
        gap = 0;
      } else if (start !== -1) {
        gap++;
        if (gap >= minGap || i === p.length) {
          const end = i - gap + 1;
          parts.push(axis === 'y' ? { x: r.x, y: r.y + start, width: r.width, height: end - start } : { x: r.x + start, y: r.y, width: end - start, height: r.height });
          start = -1;
          gap = 0;
        }
      }
    }
    return parts;
  };

  const visit = (r: Rect, depth: number, axis: 'x' | 'y', failedOther: boolean) => {
    const t = trim(r);
    if (!t || t.width < minSize || t.height < minSize) return;
    const parts = split(t, axis);
    if (parts.length > 1 && depth < maxDepth) {
      for (const p of parts) visit(p, depth + 1, axis === 'y' ? 'x' : 'y', false);
    } else if (!failedOther && depth < maxDepth) {
      visit(t, depth + 1, axis === 'y' ? 'x' : 'y', true);
    } else {
      out.push(t);
    }
  };

  visit({ x: 0, y: 0, width: w, height: h }, 0, 'y', false);
  return out;
}

/** Cor mais frequente (quantizada em 4 bits por canal) entre os pixels dados. */
function modeColor(pixels: RGBA[]): { color: RGBA; share: number } {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (const p of pixels) {
    const key = ((p.r >> 4) << 8) | ((p.g >> 4) << 4) | (p.b >> 4);
    const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    e.r += p.r;
    e.g += p.g;
    e.b += p.b;
    e.n++;
    buckets.set(key, e);
  }
  let best = { r: 255, g: 255, b: 255, n: 0 };
  for (const e of buckets.values()) if (e.n > best.n) best = e;
  return { color: { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n, a: 1 }, share: pixels.length ? best.n / pixels.length : 0 };
}

/** Percentil do núcleo do glifo por altura da linha de texto (px). */
export function corePercentile(lineHeight: number): number {
  if (lineHeight < 13) return 0.04;
  if (lineHeight < 16) return 0.08;
  return 0.15;
}

/**
 * Subestimação residual do contraste medido por pixels, por altura de linha,
 * obtida na calibração. O achado só é proposto quando o contraste medido fica
 * abaixo do mínimo mesmo descontando essa margem.
 */
export function contrastMargin(lineHeight: number): number {
  if (lineHeight < 13) return 0.06;
  if (lineHeight < 16) return 0.03;
  return 0.02;
}

export interface TextColorSample {
  foreground: string;
  background: string;
  ratio: number;
  /** Uniformidade do fundo (0..1): baixa indica texto sobre foto ou gradiente. */
  backgroundUniformity: number;
}

/**
 * Estima as cores de texto e fundo dentro de uma caixa de texto (do OCR).
 * Fundo = cor dominante do anel em volta da caixa; texto = média dos pixels
 * mais distantes do fundo (núcleo dos glifos, sem a borda suavizada).
 */
export function sampleTextColors(r: Raster, box: Rect): TextColorSample | null {
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(r.width - 1, Math.round(box.x + box.width));
  const y1 = Math.min(r.height - 1, Math.round(box.y + box.height));
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  const ring: RGBA[] = [];
  const pad = 2;
  for (let x = Math.max(0, x0 - pad); x <= Math.min(r.width - 1, x1 + pad); x++) {
    if (y0 - pad >= 0) ring.push(px(r, x, y0 - pad));
    if (y1 + pad < r.height) ring.push(px(r, x, y1 + pad));
  }
  for (let y = y0; y <= y1; y++) {
    if (x0 - pad >= 0) ring.push(px(r, x0 - pad, y));
    if (x1 + pad < r.width) ring.push(px(r, x1 + pad, y));
  }
  if (ring.length < 8) return null;
  const { color: bg, share } = modeColor(ring);
  const bgLab = rgbToLab(bg);
  const inner: { p: RGBA; d: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const p = px(r, x, y);
    const d = Math.abs(p.r - bg.r) + Math.abs(p.g - bg.g) + Math.abs(p.b - bg.b);
    if (d > 30) inner.push({ p, d });
  }
  if (inner.length < 6) return null;
  inner.sort((a, b) => b.d - a.d);
  // Fração dos pixels mais distantes do fundo usada como "núcleo" do glifo, calibrada contra
  // texto renderizado com cores conhecidas (test/vision-calibration.test.ts): glifos pequenos
  // têm hastes de 1 px que nunca atingem a cor plena, então usam só os pixels mais extremos.
  const core = inner.slice(0, Math.max(3, Math.floor(inner.length * corePercentile(box.height))));
  const fg = core.reduce((acc, { p }) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b, a: 1 }), { r: 0, g: 0, b: 0, a: 1 });
  fg.r /= core.length;
  fg.g /= core.length;
  fg.b /= core.length;
  if (deltaE2000(rgbToLab(fg), bgLab) < 3) return null;
  return { foreground: toHex(fg), background: toHex(bg), ratio: Math.round(contrastRatio(fg, bg) * 100) / 100, backgroundUniformity: share };
}

/** Cor dominante e uniformidade de uma região (para reconhecer superfícies preenchidas). */
export function regionFill(r: Raster, rect: Rect, step = 2): { color: RGBA; uniformity: number } {
  const pixels: RGBA[] = [];
  for (let y = Math.max(0, Math.round(rect.y)); y < Math.min(r.height, rect.y + rect.height); y += step) {
    for (let x = Math.max(0, Math.round(rect.x)); x < Math.min(r.width, rect.x + rect.width); x += step) pixels.push(px(r, x, y));
  }
  const m = modeColor(pixels);
  return { color: m.color, uniformity: m.share };
}

export function sameColor(a: RGBA, b: RGBA, tolerance = 6): boolean {
  return deltaE2000(rgbToLab(a), rgbToLab(b)) < tolerance;
}

export interface Surface {
  rect: Rect;
  fill: RGBA;
  /** Fração do perímetro da caixa pertencente à superfície (1 = retângulo perfeito). */
  rectangularity: number;
}

/**
 * Detecção de superfícies por componentes conexos: pixels vizinhos com a mesma
 * cor quantizada formam regiões; regiões de contorno retangular, que se
 * destacam do entorno, são candidatas a botões, selos e campos. Opera numa
 * cópia reduzida (até 800 px) e devolve coordenadas no espaço do raster.
 */
export function findSurfaces(r: Raster, opts: { minHeight?: number; maxHeight?: number } = {}): Surface[] {
  const f = Math.min(1, 800 / r.width);
  const w = Math.max(1, Math.round(r.width * f));
  const h = Math.max(1, Math.round(r.height * f));
  const key = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = px(r, Math.min(r.width - 1, Math.floor(x / f)), Math.min(r.height - 1, Math.floor(y / f)));
    key[y * w + x] = ((p.r >> 4) << 8) | ((p.g >> 4) << 4) | (p.b >> 4);
  }
  const label = new Int32Array(w * h).fill(-1);
  const minH = (opts.minHeight ?? 16) * f;
  const maxH = (opts.maxHeight ?? 90) * f;
  const out: Surface[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1) continue;
    const k = key[start]!;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    stack.push(start);
    label[start] = next;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const n of nb) if (n >= 0 && label[n] === -1 && key[n] === k) {
        label[n] = next;
        stack.push(n);
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const id = next++;
    if (bh < minH || bh > maxH || bw < 24 * f || bw > w * 0.6 || bw / bh < 1.2 || bw / bh > 16 || area < bw * bh * 0.35) continue;
    // Retangularidade: o contorno da caixa precisa pertencer à superfície.
    let edge = 0;
    let total = 0;
    for (let x = minX; x <= maxX; x++) {
      total += 2;
      if (label[minY * w + x] === id) edge++;
      if (label[maxY * w + x] === id) edge++;
    }
    for (let y = minY; y <= maxY; y++) {
      total += 2;
      if (label[y * w + minX] === id) edge++;
      if (label[y * w + maxX] === id) edge++;
    }
    const rectangularity = edge / total;
    if (rectangularity < 0.7) continue;
    const rect = { x: minX / f, y: minY / f, width: bw / f, height: bh / f };
    const fill = px(r, Math.round(rect.x + 2 / f), Math.round(rect.y + rect.height / 2));
    // Precisa se destacar do entorno imediato.
    const around = regionFill(r, { x: rect.x - 6, y: rect.y - 6, width: rect.width + 12, height: 4 }, 1);
    if (sameColor(around.color, fill, 8)) continue;
    out.push({ rect, fill, rectangularity });
  }
  return out;
}

/** Recorte ampliado, em tons de cinza e com polaridade normalizada (texto escuro sobre claro) para OCR de rótulos. */
export async function labelCrop(r: Raster, rect: Rect, fill: RGBA): Promise<Buffer> {
  const x = Math.max(0, Math.round(rect.x + 2));
  const y = Math.max(0, Math.round(rect.y + 2));
  const width = Math.max(4, Math.min(r.width - x, Math.round(rect.width - 4)));
  const height = Math.max(4, Math.min(r.height - y, Math.round(rect.height - 4)));
  const lum = 0.299 * fill.r + 0.587 * fill.g + 0.114 * fill.b;
  let img = sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } })
    .extract({ left: x, top: y, width, height })
    .resize({ width: width * 3, kernel: 'lanczos3' })
    .grayscale()
    .normalise();
  if (lum < 150) img = img.negate({ alpha: false });
  return img.extend({ top: 12, bottom: 12, left: 12, right: 12, background: lum < 150 ? '#ffffff' : { r: Math.round(fill.r), g: Math.round(fill.g), b: Math.round(fill.b) } }).png().toBuffer();
}

/** Fração de pixels escuros (luminância < 90): indica onde há texto claro sobre fundo escuro. */
export function darkRatio(r: Raster): number {
  let dark = 0;
  const n = r.width * r.height;
  for (let i = 0, j = 0; i < n; i += 4, j += 12) {
    if (0.299 * r.data[j]! + 0.587 * r.data[j + 1]! + 0.114 * r.data[j + 2]! < 90) dark++;
  }
  return dark / Math.ceil(n / 4);
}
