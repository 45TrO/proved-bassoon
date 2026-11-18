import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRules } from '../src/analysis/engine.js';
import { closeBrowser } from '../src/capture/browser.js';
import { captureUrl, CaptureError } from '../src/capture/capture.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { startFixtureServers, type Servers } from './fixtureServer.js';

let servers: Servers;
let config: AppConfig;
let outDir: string;

beforeAll(async () => {
  servers = await startFixtureServers();
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uidoctor-test-'));
  config = loadConfig({
    UIDOCTOR_DATA_DIR: outDir,
    // Somente o servidor de páginas é liberado; o servidor "secreto" não.
    UIDOCTOR_ALLOW_PRIVATE_HOSTS: `127.0.0.1:${servers.sitePort}`,
    UIDOCTOR_DISABLE_AI: '1',
  });
});

afterAll(async () => {
  await closeBrowser();
  await servers.close();
  await fs.rm(outDir, { recursive: true, force: true });
});

describe('pipeline de captura e análise', () => {
  it('detecta problemas reais com evidência na página defeituosa e bloqueia SSRF', async () => {
    const out = await captureUrl({ url: `${servers.siteUrl}/flawed.html`, outDir, config });
    expect(Object.keys(out.snapshots).sort()).toEqual(['desktop', 'mobile', 'tablet']);
    for (const c of out.captures) {
      const stat = await fs.stat(path.join(outDir, c.file));
      expect(stat.size).toBeGreaterThan(1000);
    }

    const { issues, identity } = runRules(out.snapshots);
    const ids = issues.map((i) => i.ruleId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'a11y.contrast',
        'a11y.img-alt',
        'a11y.unnamed-control',
        'a11y.form-label',
        'a11y.lang',
        'a11y.zoom-disabled',
        'a11y.heading-order',
        'visual.h1-missing',
        'visual.hierarchy-inverted',
        'ux.touch-target',
        'ux.form-length',
        'ux.link-text',
        'responsive.overflow',
        'responsive.small-text',
      ]),
    );

    // Toda evidência de elemento aponta para um seletor e um retângulo reais.
    const contrast = issues.find((i) => i.ruleId === 'a11y.contrast')!;
    expect(contrast.evidence[0]!.selector).toBeTruthy();
    expect(contrast.evidence[0]!.rect!.width).toBeGreaterThan(0);
    expect(Number(contrast.evidence.find((e) => e.snippet?.includes('cinza claro'))!.measured.ratio)).toBeLessThan(4.5);

    const overflow = issues.find((i) => i.ruleId === 'responsive.overflow' && i.id.endsWith(':mobile'))!;
    expect(overflow.evidence.some((e) => e.selector?.includes('div'))).toBe(true);

    expect(identity.palette.length).toBeGreaterThan(2);
    expect(identity.typography.map((t) => t.family)).toEqual(expect.arrayContaining(['Georgia']));

    // Nenhuma requisição chegou ao serviço interno (img, fetch, localhost, WebSocket, metadados).
    expect(servers.secretHits).toEqual([]);
    expect(out.blocked.length).toBeGreaterThan(0);
  }, 90_000);

  it('produz poucos problemas na página bem construída', async () => {
    const out = await captureUrl({ url: `${servers.siteUrl}/clean.html`, outDir, config, filePrefix: 'clean-' });
    const { issues } = runRules(out.snapshots);
    const serious = issues.filter((i) => i.severity === 'critical' || i.severity === 'high');
    expect(serious.map((i) => i.ruleId)).toEqual([]);
    expect(issues.find((i) => i.ruleId === 'responsive.overflow')).toBeUndefined();
  }, 90_000);

  it('não acusa SVG ampliado nem camadas de superfície neutras (regressão de falsos positivos)', async () => {
    const out = await captureUrl({ url: `${servers.siteUrl}/demo-store.html`, outDir, config, filePrefix: 'demo-' });
    const { issues } = runRules(out.snapshots);
    const ids = issues.map((i) => i.ruleId);
    expect(ids).not.toContain('visual.img-upscaled');
    expect(ids).not.toContain('visual.img-distorted');
    expect(ids).not.toContain('identity.near-duplicate-colors');
    // Os problemas reais da página continuam sendo detectados.
    expect(ids).toEqual(expect.arrayContaining(['a11y.contrast', 'a11y.img-alt', 'responsive.overflow', 'responsive.nav', 'ux.touch-target']));
  }, 90_000);

  it('bloqueia redirect para rede interna', async () => {
    await expect(
      captureUrl({ url: `${servers.siteUrl}/redirect-internal`, outDir, config, filePrefix: 'redir-' }),
    ).rejects.toBeInstanceOf(CaptureError);
    expect(servers.secretHits).toEqual([]);
  }, 60_000);

  it('reporta HTTP de erro do site como falha amigável', async () => {
    await expect(captureUrl({ url: `${servers.siteUrl}/missing`, outDir, config, filePrefix: 'missing-' })).rejects.toThrow(/HTTP 404/);
  }, 60_000);

  it('recusa o host interno mesmo que a navegação seja tentada diretamente', async () => {
    await expect(captureUrl({ url: 'http://127.0.0.1:1/', outDir, config, filePrefix: 'direct-' })).rejects.toBeInstanceOf(CaptureError);
  }, 60_000);
});
