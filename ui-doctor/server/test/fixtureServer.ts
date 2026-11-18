import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');

export interface Servers {
  siteUrl: string;
  sitePort: number;
  secretHits: string[];
  close: () => Promise<void>;
}

/**
 * Sobe dois servidores locais:
 *  - "site": páginas de teste (liberado explicitamente na allowlist dos testes);
 *  - "secret": simula um serviço interno. Os testes verificam que ele NUNCA é atingido.
 */
export async function startFixtureServers(): Promise<Servers> {
  const secretHits: string[] = [];
  const secret = http.createServer((req, res) => {
    secretHits.push(req.url ?? '');
    res.end('internal-secret');
  });
  secret.on('upgrade', (req, socket) => {
    secretHits.push(`upgrade ${req.url}`);
    socket.destroy();
  });
  await new Promise<void>((r) => secret.listen(0, '127.0.0.1', r));
  const secretPort = (secret.address() as AddressInfo).port;

  const site = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/redirect-internal') {
      res.writeHead(302, { location: `http://127.0.0.1:${secretPort}/redirected` }).end();
      return;
    }
    if (url.pathname === '/missing') {
      res.writeHead(404).end('not found');
      return;
    }
    const name = path.basename(url.pathname === '/' ? 'clean.html' : url.pathname);
    try {
      let body = await fs.readFile(path.join(FIXTURES, name), 'utf8');
      body = body.replaceAll('__SECRET_PORT__', String(secretPort));
      const type = name.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
      res.writeHead(200, { 'content-type': type }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const sitePort = (site.address() as AddressInfo).port;

  return {
    siteUrl: `http://127.0.0.1:${sitePort}`,
    sitePort,
    secretHits,
    close: async () => {
      site.closeAllConnections();
      secret.closeAllConnections();
      await Promise.all([new Promise((r) => site.close(r)), new Promise((r) => secret.close(r))]);
    },
  };
}
