import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contrastRatio, parseColor } from '../src/analysis/color.js';
import { loadRaster, sampleTextColors } from '../src/vision/imageOps.js';
import { recognize, terminateOcr } from '../src/vision/ocr.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Calibração permanente do estimador de contraste por pixels: renderiza texto com
 * cores conhecidas e confere o erro da medição. Se alguém alterar o estimador e o
 * erro passar do limite, o teste falha.
 */
const PAIRS = [
  ['#666c79', '#f6f7f9'],
  ['#a39383', '#fbf7f2'],
  ['#757575', '#ffffff'],
  ['#b5b5b5', '#ffffff'],
  ['#747a88', '#16191f'],
  ['#ffffff', '#c9824a'],
] as const;
const SIZES = [12, 14, 16, 20, 28];

let browser: Browser;
let dataDir: string;
beforeAll(async () => {
  browser = await chromium.launch();
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uidoctor-calib-'));
});
afterAll(async () => {
  await browser.close();
  await terminateOcr();
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function render(html: string, height: number): Promise<{ png: Buffer; jpg: Buffer; boxes: { x: number; y: number; w: number; h: number }[] }> {
  const page = await browser.newPage({ viewport: { width: 1000, height }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const png = await page.screenshot({ type: 'png', fullPage: true });
  const jpg = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: true });
  const boxes = await page.$$eval('span', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  await page.close();
  return { png, jpg, boxes };
}

describe('calibração do contraste medido por pixels', () => {
  it('erro médio por tamanho de fonte fica dentro de ±10% (PNG e JPEG)', async () => {
    let html = '<body style="margin:0;font-family:Arial">';
    const samples: { fg: string; bg: string; size: number }[] = [];
    let top = 10;
    for (const [fg, bg] of PAIRS) for (const size of SIZES) {
      html += `<div style="position:absolute;left:10px;top:${top}px;padding:8px 12px;background:${bg}"><span style="color:${fg};font-size:${size}px;line-height:1">Texto legível de exemplo</span></div>`;
      samples.push({ fg, bg, size });
      top += size + 28;
    }
    const { png, jpg, boxes } = await render(`${html}</body>`, top + 20);
    for (const buf of [png, jpg]) {
      const raster = await loadRaster(buf);
      const errs = new Map<number, number[]>();
      samples.forEach((s, i) => {
        const b = boxes[i]!;
        const m = sampleTextColors(raster, { x: b.x, y: b.y, width: b.w, height: b.h });
        expect(m, `sem amostra para ${s.fg}/${s.bg} ${s.size}px`).not.toBeNull();
        const truth = contrastRatio(parseColor(s.fg)!, parseColor(s.bg)!);
        errs.set(s.size, [...(errs.get(s.size) ?? []), (m!.ratio - truth) / truth]);
      });
      for (const [size, e] of errs) {
        const mean = e.reduce((a, c) => a + c, 0) / e.length;
        expect(Math.abs(mean), `erro médio em ${size}px`).toBeLessThan(0.1);
      }
    }
  }, 60_000);

  it('com CLAHE, o OCR lê texto de baixo contraste e mede o contraste real', async () => {
    const html = '<body style="margin:0;background:#fff"><p style="margin:40px;font:14px Arial;color:#b5b5b5">Este texto cinza claro tem contraste insuficiente</p></body>';
    const { png } = await render(html, 120);
    const raster = await loadRaster(png);
    const enhanced = await sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 3 } }).grayscale().clahe({ width: 48, height: 48, maxSlope: 6 }).png().toBuffer();
    const ocr = await recognize(dataDir, enhanced);
    const line = ocr.lines.find((l) => /cinza/i.test(l.text));
    expect(line, 'OCR deveria ler a linha cinza').toBeTruthy();
    const m = sampleTextColors(raster, line!.box)!;
    expect(m.ratio).toBeGreaterThan(1.85);
    expect(m.ratio).toBeLessThan(2.3); // verdade: 2.06:1
  }, 60_000);
});
