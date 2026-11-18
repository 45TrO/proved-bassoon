import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Locator } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeBrowser } from '../src/capture/browser.js';
import { loadConfig } from '../src/config.js';
import { startFixtureServers, type Servers } from './fixtureServer.js';

/**
 * Fluxo completo no navegador, usando o frontend compilado (web/dist).
 * Rode `npm run build -w web` antes; sem o build o teste é ignorado.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');
const hasDist = fs.existsSync(path.join(webDist, 'index.html'));

/** Espera o locator ficar visível (falha com timeout). */
const visible = (loc: Locator) => loc.waitFor({ state: 'visible', timeout: 15_000 });
async function hasText(loc: Locator, text: string) {
  await visible(loc);
  expect(await loc.textContent()).toContain(text);
}

let servers: Servers;
let app: FastifyInstance;
let base = '';
let browser: Browser;
let dataDir: string;

describe.skipIf(!hasDist)('E2E: fluxo principal no navegador', () => {
  beforeAll(async () => {
    servers = await startFixtureServers();
    dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'uidoctor-e2e-'));
    const config = loadConfig({
      UIDOCTOR_DATA_DIR: dataDir,
      UIDOCTOR_WEB_DIST: webDist,
      UIDOCTOR_ALLOW_PRIVATE_HOSTS: `127.0.0.1:${servers.sitePort}`,
      UIDOCTOR_RATE_LIMIT: '100',
    });
    ({ app } = await buildApp({ config, logger: false }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await app?.close();
    await closeBrowser();
    await servers?.close();
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  it('analisa uma URL, inspeciona evidências, gera antes/depois e atualiza o painel', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(base);
    // Validação no cliente
    await page.getByLabel('Endereço da página').fill('intranet');
    await page.getByRole('button', { name: 'Analisar interface' }).click();
    await hasText(page.getByRole('alert'), 'domínio completo');

    // Bloqueio de SSRF exibido pela interface
    await page.getByLabel('Endereço da página').fill('http://169.254.169.254/latest');
    await page.getByRole('button', { name: 'Analisar interface' }).click();
    await hasText(page.getByRole('alert'), 'privados ou reservados');

    // Análise real
    await page.getByLabel('Endereço da página').fill(`${servers.siteUrl}/demo-store.html`);
    await page.getByRole('button', { name: 'Analisar interface' }).click();
    await page.waitForURL(/\/analises\//);
    await page.getByRole('tab', { name: /Diagnóstico/ }).waitFor({ timeout: 60_000 });
    await visible(page.getByRole('img', { name: /Nota geral: \d+ de 100/ }).first());
    await visible(page.getByRole('heading', { name: /Café Aurora/ }));

    // Selecionar um problema mostra as medições e as marcações no screenshot
    // O botão da lista (aria-expanded); as caixas do inspetor também levam o título do problema.
    await page.getByRole('button', { name: /Texto com contraste insuficiente/, expanded: false }).click();
    await visible(page.getByText('Mínimo exigido').first());
    expect(new URL(page.url()).searchParams.get('problema')).toBe('a11y.contrast');
    await visible(page.locator('img[alt^="Captura da interface"]'));

    // Marcar como corrigido
    await page.getByRole('button', { name: /Marcar como corrigido/ }).click();
    await visible(page.getByText('Marcado como corrigido'));

    // Identidade visual
    await page.getByRole('tab', { name: 'Identidade visual' }).click();
    await visible(page.getByRole('heading', { name: 'Paleta detectada' }));
    await visible(page.getByRole('heading', { name: 'Paletas recomendadas' }));

    // Antes e depois
    await page.getByRole('tab', { name: 'Antes e depois' }).click();
    await page.getByRole('button', { name: /Gerar proposta/ }).click();
    await page.getByRole('heading', { name: /Alterações aplicadas/ }).waitFor({ timeout: 90_000 });
    await visible(page.getByLabel('Posição da comparação entre antes e depois'));
    await page.getByRole('radio', { name: /Lado a lado/ }).click();
    await visible(page.getByRole('img', { name: /Depois: captura/ }));

    // Painel reflete a análise e a melhoria implementada
    await page.getByRole('link', { name: 'Painel' }).first().click();
    await visible(page.getByRole('heading', { name: 'Painel' }));
    await visible(page.getByText('Melhorias implementadas'));
    await visible(page.getByRole('heading', { name: 'Problemas por severidade' }));

    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);

  it('é utilizável no mobile sem rolagem horizontal', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const route of ['/', '/painel', '/projetos']) {
      await page.goto(base + route);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) {
        console.log(await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          return Array.from(document.querySelectorAll('body *')).filter((el) => el.getBoundingClientRect().right > vw + 1).slice(0, 8)
            .map((el) => `${el.tagName}.${String(el.className).slice(0, 80)} w=${Math.round(el.getBoundingClientRect().width)}`).join('\n');
        }));
      }
      expect(overflow, `overflow em ${route}`).toBeLessThanOrEqual(0);
    }
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await page.getByRole('link', { name: 'Projetos' }).click();
    await visible(page.getByRole('heading', { name: 'Projetos' }));
    await page.close();
  }, 60_000);

  it('rotas desconhecidas e análises inexistentes têm estados claros', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/qualquer-coisa`);
    await visible(page.getByRole('heading', { name: 'Esta página não existe' }));
    await page.goto(`${base}/analises/00000000-0000-4000-8000-000000000000`);
    await visible(page.getByRole('heading', { name: 'Análise não encontrada' }));
    // Asset inexistente é 404 (nunca o index.html, que quebraria o carregamento de módulos).
    const missing = await fetch(`${base}/assets/nao-existe-123.js`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).not.toContain('text/html');
    const root = await fetch(`${base}/`);
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toContain('text/html');
    const spa = await fetch(`${base}/projetos/qualquer`);
    expect(spa.headers.get('content-type')).toContain('text/html');
    await page.close();
  }, 60_000);
});
