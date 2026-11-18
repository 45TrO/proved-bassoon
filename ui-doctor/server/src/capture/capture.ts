import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import type { AppConfig } from '../config.js';
import { VIEWPORTS, type Capture, type ViewportName, type ViewportSpec } from '../domain/types.js';
import { startEgressProxy, type BlockedRequest } from '../security/egressProxy.js';
import { getBrowser } from './browser.js';
import { COLLECTOR_SOURCE } from './collector.js';
import type { Snapshot } from './snapshot.js';

export class CaptureError extends Error {
  constructor(
    message: string,
    public readonly code: 'blocked' | 'unreachable' | 'http_error' | 'timeout' | 'browser',
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

export interface CaptureOptions {
  url: string;
  outDir: string;
  config: AppConfig;
  viewports?: readonly ViewportSpec[];
  /** CSS injetado após o carregamento (modo "depois" do redesign). */
  injectCss?: string;
  filePrefix?: string;
  /** Gera recortes do topo (2 dobras) de desktop e mobile para o pipeline de visão. */
  topCrops?: boolean;
  /** Salva o HTML renderizado do desktop para o parser de DOM. */
  saveHtml?: boolean;
  onViewport?: (viewport: ViewportName, phase: 'start' | 'done') => void;
  signal?: AbortSignal;
}

export interface TopCrop {
  viewport: ViewportName;
  file: string;
  width: number;
  height: number;
}

export interface CaptureOutput {
  topCrops: TopCrop[];
  /** Erros de JavaScript/console da própria página, por viewport. */
  jsErrors: number;
  snapshots: Partial<Record<ViewportName, Snapshot>>;
  captures: Capture[];
  finalUrl: string;
  title: string;
  blocked: BlockedRequest[];
  failedViewports: { viewport: ViewportName; reason: string }[];
}

const MAX_REQUESTS_PER_PAGE = 800;
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 UIDoctor/1.0';
const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 UIDoctor/1.0';

/** Extrai o host de um alvo registrado pelo proxy ("host:porta" ou URL absoluta). */
export function blockedHost(target: string): string {
  try {
    if (/^https?:\/\//i.test(target)) return new URL(target).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
  return target.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
}

async function autoScroll(page: Page, maxHeight: number) {
  await page.evaluate(
    `(async () => {
      const step = Math.max(200, Math.floor(window.innerHeight * 0.85));
      const limit = ${maxHeight};
      for (let y = 0; y < Math.min(document.documentElement.scrollHeight, limit); y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo(0, 0);
    })()`,
  );
  await page.waitForTimeout(350);
}

async function newIsolatedContext(
  options: CaptureOptions,
  spec: ViewportSpec,
  proxyUrl: string,
): Promise<BrowserContext> {
  const browser = await getBrowser(options.config);
  const mobile = spec.name === 'mobile';
  const context = await browser.newContext({
    viewport: { width: spec.width, height: spec.height },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: spec.name !== 'desktop',
    userAgent: mobile ? MOBILE_UA : DESKTOP_UA,
    locale: 'pt-BR',
    proxy: { server: proxyUrl, bypass: '<-loopback>' },
    serviceWorkers: 'block',
    acceptDownloads: false,
    permissions: [],
    ignoreHTTPSErrors: false,
    bypassCSP: Boolean(options.injectCss),
    javaScriptEnabled: true,
    reducedMotion: 'reduce',
  });
  let requests = 0;
  await context.route('**/*', async (route) => {
    const u = route.request().url();
    if (!/^https?:\/\//i.test(u) || ++requests > MAX_REQUESTS_PER_PAGE) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  return context;
}

async function captureViewport(
  options: CaptureOptions,
  spec: ViewportSpec,
  proxyUrl: string,
  blocked: BlockedRequest[],
): Promise<{ snapshot: Snapshot; capture: Capture; finalUrl: string; title: string; topCrop?: TopCrop; jsErrors: number }> {
  const { config } = options;
  const context = await newIsolatedContext(options, spec, proxyUrl);
  try {
    const page = await context.newPage();
    // Pop-ups e novas abas abertas pela página são fechados imediatamente.
    context.on('page', (p) => {
      if (p !== page) void p.close().catch(() => undefined);
    });
    page.on('dialog', (d) => void d.dismiss().catch(() => undefined));
    let jsErrors = 0;
    page.on('pageerror', () => jsErrors++);
    page.on('console', (m) => {
      if (m.type() === 'error') jsErrors++;
    });
    page.setDefaultTimeout(config.navigationTimeoutMs);

    let response;
    try {
      response = await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    } catch (err) {
      const msg = (err as Error).message;
      const targetHost = new URL(options.url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
      const mainBlocked = blocked.find((b) => blockedHost(b.target) === targetHost);
      if (mainBlocked) throw new CaptureError(`Acesso bloqueado pela política de segurança: ${mainBlocked.reason}.`, 'blocked');
      if (/timeout/i.test(msg)) throw new CaptureError('A página demorou demais para responder.', 'timeout');
      if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY|ERR_CONNECTION|ERR_NAME|ERR_ADDRESS/i.test(msg)) {
        throw new CaptureError('Não foi possível conectar ao site. Verifique a URL e se o site está no ar.', 'unreachable');
      }
      throw new CaptureError(`Falha ao carregar a página: ${msg.split('\n')[0]}`, 'unreachable');
    }
    if (!response) throw new CaptureError('O site não retornou resposta.', 'unreachable');
    const status = response.status();
    if (status === 403 && (await response.text().catch(() => '')).includes('UI Doctor egress policy')) {
      throw new CaptureError('Destino bloqueado pela política de segurança (rede interna ou porta não permitida).', 'blocked');
    }
    if (status >= 400) throw new CaptureError(`O site respondeu com HTTP ${status}.`, 'http_error');

    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
    await page.evaluate('document.fonts && document.fonts.ready').catch(() => undefined);
    await autoScroll(page, config.maxCaptureHeight).catch(() => undefined);

    if (options.injectCss) {
      await page.addStyleTag({ content: options.injectCss });
      await page.waitForTimeout(250);
    }

    const snapshot = (await page.evaluate(COLLECTOR_SOURCE)) as Snapshot;
    if (options.saveHtml && spec.name === 'desktop') {
      const html = await page.content().catch(() => '');
      await fs.writeFile(path.join(options.outDir, `${options.filePrefix ?? ''}desktop.html`), html.slice(0, 5_000_000));
    }
    const height = Math.max(spec.height, Math.min(snapshot.docHeight, config.maxCaptureHeight));
    const file = `${options.filePrefix ?? ''}${spec.name}.jpg`;
    await page.screenshot({
      path: path.join(options.outDir, file),
      type: 'jpeg',
      quality: 85,
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      clip: { x: 0, y: 0, width: spec.width, height },
    });
    let topCrop: TopCrop | undefined;
    if (options.topCrops && spec.name !== 'tablet') {
      const cropHeight = Math.min(height, spec.height * 2);
      const topFile = `${options.filePrefix ?? ''}${spec.name}-top.jpg`;
      await page.screenshot({
        path: path.join(options.outDir, topFile),
        type: 'jpeg',
        quality: 85,
        animations: 'disabled',
        caret: 'hide',
        clip: { x: 0, y: 0, width: spec.width, height: cropHeight },
        fullPage: true,
      });
      topCrop = { viewport: spec.name, file: topFile, width: spec.width, height: cropHeight };
    }
    return {
      snapshot,
      jsErrors,
      topCrop,
      capture: {
        viewport: spec.name,
        width: spec.width,
        height: spec.height,
        fullHeight: height,
        documentHeight: snapshot.docHeight,
        file,
      },
      finalUrl: page.url(),
      title: snapshot.title,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function captureUrl(options: CaptureOptions): Promise<CaptureOutput> {
  await fs.mkdir(options.outDir, { recursive: true });
  const proxy = await startEgressProxy({
    allowPrivate: options.config.allowPrivateHosts,
    upstream: options.config.upstreamProxy,
  });
  const out: CaptureOutput = {
    snapshots: {},
    captures: [],
    finalUrl: options.url,
    title: '',
    blocked: proxy.blocked,
    failedViewports: [],
    topCrops: [],
    jsErrors: 0,
  };
  try {
    const viewports = options.viewports ?? VIEWPORTS;
    for (const [index, spec] of viewports.entries()) {
      if (options.signal?.aborted) throw new CaptureError('Análise cancelada.', 'timeout');
      options.onViewport?.(spec.name, 'start');
      try {
        const r = await captureViewport(options, spec, proxy.url, proxy.blocked);
        out.snapshots[spec.name] = r.snapshot;
        out.captures.push(r.capture);
        if (r.topCrop) out.topCrops.push(r.topCrop);
        out.jsErrors = Math.max(out.jsErrors, r.jsErrors);
        if (index === 0) {
          out.finalUrl = r.finalUrl;
          out.title = r.title;
        }
      } catch (err) {
        // O primeiro viewport define se o site é acessível; nos demais, registra e segue.
        if (index === 0 || !(err instanceof CaptureError)) throw err;
        out.failedViewports.push({ viewport: spec.name, reason: err.message });
      }
      options.onViewport?.(spec.name, 'done');
    }
    return out;
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    const msg = (err as Error).message ?? String(err);
    if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
      throw new CaptureError('Navegador de captura indisponível no servidor.', 'browser');
    }
    throw err;
  } finally {
    await proxy.close();
  }
}
