import type { AppConfig } from '../config.js';
import { getBrowser } from './browser.js';

export interface PixelColor {
  r: number;
  g: number;
  b: number;
  count: number;
}

export interface ImageStats {
  width: number;
  height: number;
  colors: PixelColor[];
  /** Fração de pixels quase brancos/pretos (fundo dominante). */
  sampled: number;
}

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Detecta o tipo real pelos "magic bytes"; o content-type do upload não é confiável. */
export function sniffImage(buf: Buffer): ImageMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

const SCRIPT = String.raw`(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, 480 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  const buckets = new Map();
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    // Quantiza em 5 bits por canal para agrupar ruído de compressão e anti-aliasing.
    const r = data[i] >> 3, g = data[i + 1] >> 3, b = data[i + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;
    const e = buckets.get(key);
    if (e) { e.count++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; }
    else buckets.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], count: 1 });
    n++;
  }
  const colors = Array.from(buckets.values())
    .map((e) => ({ r: Math.round(e.r / e.count), g: Math.round(e.g / e.count), b: Math.round(e.b / e.count), count: e.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 64);
  return { width: w, height: h, colors, sampled: n };
})`;

export async function analyzeImagePixels(buf: Buffer, mime: ImageMime, config: AppConfig): Promise<ImageStats> {
  const browser = await getBrowser(config);
  // Contexto offline: nenhuma requisição de rede é possível.
  const context = await browser.newContext({ offline: true, javaScriptEnabled: true, serviceWorkers: 'block' });
  try {
    await context.route('**/*', (route) => route.abort('blockedbyclient'));
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    return (await page.evaluate(`${SCRIPT}(${JSON.stringify(dataUrl)})`)) as ImageStats;
  } finally {
    await context.close().catch(() => undefined);
  }
}
