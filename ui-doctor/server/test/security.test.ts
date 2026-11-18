import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEgressProxy, type EgressProxy } from '../src/security/egressProxy.js';
import { assertSafeUrl, isPublicAddress, parseTargetUrl, UrlRejectedError } from '../src/security/urlGuard.js';

const publicResolver = async () => ['93.184.215.14'];

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.2.10',
    '198.18.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    '2001:db8::1',
  ])('bloqueia %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['93.184.215.14', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('permite %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe('parseTargetUrl', () => {
  const rejects = (url: string, code: UrlRejectedError['code']) => {
    try {
      parseTargetUrl(url);
      throw new Error(`deveria rejeitar ${url}`);
    } catch (err) {
      expect(err).toBeInstanceOf(UrlRejectedError);
      expect((err as UrlRejectedError).code).toBe(code);
    }
  };

  it('aceita domínios públicos e completa o esquema', () => {
    expect(parseTargetUrl('exemplo.com.br/loja').url.href).toBe('https://exemplo.com.br/loja');
    expect(parseTargetUrl('http://exemplo.com:8080/').port).toBe(8080);
  });

  it('recusa esquemas perigosos', () => {
    rejects('file:///etc/passwd', 'scheme');
    rejects('javascript:alert(1)', 'scheme');
    rejects('ftp://exemplo.com', 'scheme');
    rejects('gopher://exemplo.com:70/', 'scheme');
    rejects('data:text/html,<h1>x</h1>', 'scheme');
  });

  it('recusa credenciais embutidas', () => rejects('https://user:pass@exemplo.com', 'credentials'));

  it('recusa portas fora da lista', () => {
    rejects('http://exemplo.com:22/', 'port');
    rejects('http://exemplo.com:6379/', 'port');
  });

  it('recusa nomes internos', () => {
    rejects('http://localhost/', 'host');
    rejects('http://api.localhost/', 'host');
    rejects('http://printer.local/', 'host');
    rejects('http://metadata.google.internal/', 'host');
    rejects('http://intranet/', 'host');
    rejects('http://redis.default.svc.cluster.local/', 'host');
  });

  it('recusa IPs privados em qualquer notação', () => {
    rejects('http://127.0.0.1/', 'private_address');
    rejects('http://2130706433/', 'private_address'); // decimal
    rejects('http://0x7f.0.0.1/', 'private_address'); // hexadecimal
    rejects('http://0177.0.0.1/', 'private_address'); // octal
    rejects('http://127.1/', 'private_address'); // abreviado
    rejects('http://[::1]/', 'private_address');
    rejects('http://[::ffff:169.254.169.254]/', 'private_address');
    rejects('http://169.254.169.254/latest/meta-data/', 'private_address');
  });

  it('recusa URLs longas demais', () => rejects(`https://exemplo.com/${'a'.repeat(2100)}`, 'length'));

  it('allowlist explícita libera apenas o par host:porta indicado', () => {
    const allow = new Set(['127.0.0.1:4599']);
    expect(parseTargetUrl('http://127.0.0.1:4599/', { allowPrivate: allow }).port).toBe(4599);
    expect(() => parseTargetUrl('http://127.0.0.1:4600/', { allowPrivate: allow })).toThrow(UrlRejectedError);
  });
});

describe('assertSafeUrl (DNS)', () => {
  it('aceita domínio que resolve para IP público', async () => {
    const r = await assertSafeUrl('https://exemplo.com', { resolver: publicResolver });
    expect(r.address).toBe('93.184.215.14');
  });

  it('bloqueia domínio que resolve para IP interno (DNS rebinding / nip.io)', async () => {
    await expect(assertSafeUrl('https://127.0.0.1.nip.io', { resolver: async () => ['127.0.0.1'] })).rejects.toMatchObject({ code: 'private_address' });
  });

  it('bloqueia quando QUALQUER registro aponta para rede interna', async () => {
    await expect(assertSafeUrl('https://misto.com', { resolver: async () => ['93.184.215.14', '10.0.0.5'] })).rejects.toMatchObject({ code: 'private_address' });
  });

  it('falha de DNS vira erro amigável', async () => {
    await expect(
      assertSafeUrl('https://nao-existe.invalid', {
        resolver: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toMatchObject({ code: 'dns' });
  });
});

describe('egress proxy', () => {
  let proxy: EgressProxy;
  let internal: http.Server;
  let internalPort: number;
  const hits: string[] = [];

  beforeAll(async () => {
    internal = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('secret');
    });
    await new Promise<void>((r) => internal.listen(0, '127.0.0.1', r));
    internalPort = (internal.address() as AddressInfo).port;
    proxy = await startEgressProxy({ resolver: async () => ['127.0.0.1'] });
  });

  afterAll(async () => {
    await proxy.close();
    internal.closeAllConnections();
    await new Promise((r) => internal.close(r));
  });

  function connect(target: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(proxy.port, '127.0.0.1', () => {
        sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      });
      let buf = '';
      sock.on('data', (d) => {
        buf += d.toString();
        if (buf.includes('\r\n\r\n')) {
          sock.destroy();
          resolve(buf.split('\r\n')[0]!);
        }
      });
      sock.on('error', reject);
    });
  }

  it('recusa CONNECT para IP interno', async () => {
    expect(await connect(`127.0.0.1:443`)).toMatch(/403/);
    expect(await connect(`[::1]:443`)).toMatch(/403/);
  });

  it('recusa CONNECT para domínio que resolve para rede interna', async () => {
    expect(await connect('rebind.example:443')).toMatch(/403/);
  });

  it('recusa CONNECT para porta não permitida', async () => {
    expect(await connect(`127.0.0.1:${internalPort}`)).toMatch(/403/);
  });

  it('recusa HTTP em claro para rede interna e não toca o servidor', async () => {
    const status = await new Promise<number>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'GET', path: `http://127.0.0.1:${internalPort}/x`, headers: { host: `127.0.0.1:${internalPort}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.end();
    });
    expect(status).toBe(403);
    expect(hits).toEqual([]);
    expect(proxy.blocked.length).toBeGreaterThan(0);
  });
});
