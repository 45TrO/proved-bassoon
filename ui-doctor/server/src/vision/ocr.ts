import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';
import type { Rect } from '../domain/types.js';

/**
 * OCR com Tesseract (WASM), totalmente offline: os dados de idioma vêm dos
 * pacotes npm @tesseract.js-data/* e são copiados para o diretório de dados.
 * Um único worker é compartilhado; as chamadas são serializadas.
 */
export const OCR_LANGUAGES = ['por', 'eng'] as const;

export interface OcrWord {
  text: string;
  confidence: number;
  box: Rect;
}

export interface OcrLine {
  text: string;
  confidence: number;
  box: Rect;
  words: OcrWord[];
}

export interface OcrResult {
  lines: OcrLine[];
  words: number;
  meanConfidence: number | null;
  durationMs: number;
}

const require = createRequire(import.meta.url);
let workerPromise: Promise<Worker> | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function prepareLangDir(dataDir: string): Promise<string> {
  const dir = path.join(dataDir, 'tessdata');
  await fs.mkdir(dir, { recursive: true });
  for (const lang of OCR_LANGUAGES) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    try {
      await fs.access(target);
    } catch {
      const pkgDir = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
      await fs.copyFile(path.join(pkgDir, '4.0.0_best_int', `${lang}.traineddata.gz`), target);
    }
  }
  return dir;
}

function getWorker(dataDir: string): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const langPath = await prepareLangDir(dataDir);
      const worker = await createWorker([...OCR_LANGUAGES], 1, { langPath, cachePath: langPath, gzip: true, logger: () => undefined, errorHandler: () => undefined });
      // Capturas de tela têm ~96 dpi; sem isso o Tesseract assume uma resolução inválida.
      await worker.setParameters({ user_defined_dpi: '96' });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export async function ocrReady(dataDir: string): Promise<boolean> {
  try {
    await prepareLangDir(dataDir);
    return true;
  } catch {
    return false;
  }
}

function toRect(b: { x0: number; y0: number; x1: number; y1: number }, scale: number): Rect {
  return { x: b.x0 / scale, y: b.y0 / scale, width: (b.x1 - b.x0) / scale, height: (b.y1 - b.y0) / scale };
}

/**
 * Reconhece texto. `scale` converte coordenadas da imagem processada para as
 * coordenadas da captura original (quando a imagem foi reduzida antes).
 */
export function recognize(dataDir: string, image: Buffer, scale = 1, mode: 'page' | 'line' = 'page'): Promise<OcrResult> {
  const run = async (): Promise<OcrResult> => {
    const started = Date.now();
    const worker = await getWorker(dataDir);
    // PSM 3 = segmentação automática da página; PSM 7 = uma única linha (rótulos de botões).
    await worker.setParameters({ tessedit_pageseg_mode: (mode === 'line' ? '7' : '3') as never });
    const { data } = await worker.recognize(image, {}, { blocks: true });
    const lines: OcrLine[] = [];
    let confSum = 0;
    let wordCount = 0;
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const words = line.words
            .filter((w) => w.text.trim().length > 0)
            .map((w) => ({ text: w.text.trim(), confidence: w.confidence, box: toRect(w.bbox, scale) }));
          if (words.length === 0) continue;
          for (const w of words) {
            confSum += w.confidence;
            wordCount++;
          }
          lines.push({ text: line.text.trim(), confidence: line.confidence, box: toRect(line.bbox, scale), words });
        }
      }
    }
    return { lines, words: wordCount, meanConfidence: wordCount ? Math.round(confSum / wordCount) : null, durationMs: Date.now() - started };
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate().catch(() => undefined);
}
