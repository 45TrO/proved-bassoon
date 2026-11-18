import http from 'node:http';
import net from 'node:net';
import { DEFAULT_PORTS, normalizeHostname, resolvePublicAddress, UrlRejectedError, type GuardOptions } from './urlGuard.js';

/**
 * Proxy de saída usado pelo Chromium. TODA requisição do navegador (documento,
 * redirects, sub-recursos, fetch/XHR, WebSocket seguro) passa por aqui e é
 * revalidada contra o guard de SSRF. A conexão é feita no IP que acabou de ser
 * validado, o que impede DNS rebinding entre a checagem e o uso.
 */
export interface EgressProxyOptions extends GuardOptions {
  /** Limite de bytes recebidos somando todas as conexões. */
  maxBytes?: number;
  /** Máximo de conexões simultâneas. */
  maxConnections?: number;
  /** Proxy HTTP upstream opcional (ex.: http://proxy.corp:3128). */
  upstream?: string;
  connectTimeoutMs?: number;
}

export interface BlockedRequest {
  target: string;
  reason: string;
}

export interface EgressProxy {
  port: number;
  url: string;
  blocked: BlockedRequest[];
  bytesIn: () => number;
  close: () => Promise<void>;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function splitHostPort(authority: string): { host: string; port: number } | null {
  const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(authority.trim());
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: normalizeHostname(m[1]!), port };
}

export async function startEgressProxy(opts: EgressProxyOptions = {}): Promise<EgressProxy> {
  const maxBytes = opts.maxBytes ?? 80 * 1024 * 1024;
  const maxConnections = opts.maxConnections ?? 64;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 10_000;
  const ports = opts.allowedPorts ?? DEFAULT_PORTS;
  const upstream = opts.upstream ? new URL(opts.upstream) : null;
  const blocked: BlockedRequest[] = [];
  const sockets = new Set<net.Socket>();
  let bytesIn = 0;
  let active = 0;

  const block = (target: string, reason: string) => {
    if (blocked.length < 200) blocked.push({ target, reason });
  };

  async function authorize(host: string, port: number): Promise<string> {
    const allowPrivate = opts.allowPrivate?.has(`${host}:${port}`) ?? false;
    if (!allowPrivate && !ports.has(port)) {
      throw new UrlRejectedError(`porta ${port} não permitida`, 'port');
    }
    return resolvePublicAddress(host, port, opts);
  }

  function meter(socket: net.Socket, onExceeded: () => void) {
    socket.on('data', (chunk: Buffer) => {
      bytesIn += chunk.length;
      if (bytesIn > maxBytes) onExceeded();
    });
  }

  function track(socket: net.Socket) {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  }

  const server = http.createServer(async (req, res) => {
    // Requisições HTTP em claro chegam em forma absoluta: GET http://host/path
    let target: URL;
    try {
      target = new URL(req.url ?? '');
      if (target.protocol !== 'http:') throw new Error('scheme');
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    const host = normalizeHostname(target.hostname);
    const port = target.port ? Number(target.port) : 80;
    if (active >= maxConnections) {
      block(target.href, 'limite de conexões');
      res.writeHead(503).end();
      return;
    }
    let address: string;
    try {
      address = await authorize(host, port);
    } catch (err) {
      block(target.href, (err as Error).message);
      res.writeHead(403, { 'content-type': 'text/plain' }).end('blocked by UI Doctor egress policy');
      return;
    }
    active++;
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) headers[k] = v;
    }
    headers.host = target.host;
    const upstreamReq = http.request(
      upstream
        ? { host: upstream.hostname, port: Number(upstream.port || 80), method: req.method, path: target.href, headers }
        : { host: address, port, method: req.method, path: `${target.pathname}${target.search}`, headers },
      (upRes) => {
        const outHeaders: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(upRes.headers)) {
          if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) outHeaders[k] = v;
        }
        res.writeHead(upRes.statusCode ?? 502, outHeaders);
        upRes.on('data', (chunk: Buffer) => {
          bytesIn += chunk.length;
          if (bytesIn > maxBytes) {
            block(target.href, 'limite de bytes excedido');
            upRes.destroy();
            res.destroy();
          }
        });
        upRes.pipe(res);
      },
    );
    upstreamReq.setTimeout(connectTimeoutMs * 3, () => upstreamReq.destroy(new Error('timeout')));
    upstreamReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
    upstreamReq.on('close', () => {
      active--;
    });
    req.pipe(upstreamReq);
  });

  // WebSocket em claro (ws://): recusado. wss:// passa por CONNECT e é validado.
  server.on('upgrade', (req, socket) => {
    block(String(req.url), 'websocket sem TLS bloqueado');
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });

  server.on('connect', async (req, clientSocket: net.Socket, head: Buffer) => {
    track(clientSocket);
    clientSocket.on('error', () => clientSocket.destroy());
    const authority = req.url ?? '';
    const parsed = splitHostPort(authority);
    if (!parsed) {
      block(authority, 'destino CONNECT inválido');
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    if (active >= maxConnections) {
      block(authority, 'limite de conexões');
      clientSocket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      return;
    }
    let address: string;
    try {
      address = await authorize(parsed.host, parsed.port);
    } catch (err) {
      block(authority, (err as Error).message);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    active++;
    const onDone = () => {
      active--;
    };
    const exceed = () => {
      block(authority, 'limite de bytes excedido');
      clientSocket.destroy();
      remote.destroy();
    };

    const remote = upstream
      ? net.connect({ host: upstream.hostname, port: Number(upstream.port || 80) })
      : net.connect({ host: address, port: parsed.port });
    track(remote);
    remote.setTimeout(connectTimeoutMs, () => remote.destroy());
    remote.once('close', onDone);
    remote.on('error', () => {
      if (clientSocket.writable) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });

    const startPipe = () => {
      remote.setTimeout(0);
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      meter(remote, exceed);
      remote.pipe(clientSocket);
      clientSocket.pipe(remote);
    };

    if (upstream) {
      remote.once('connect', () => {
        remote.write(`CONNECT ${parsed.host}:${parsed.port} HTTP/1.1\r\nHost: ${parsed.host}:${parsed.port}\r\n\r\n`);
        let buf = '';
        const onData = (chunk: Buffer) => {
          buf += chunk.toString('latin1');
          const end = buf.indexOf('\r\n\r\n');
          if (end === -1) return;
          remote.off('data', onData);
          if (!/^HTTP\/1\.[01] 200/.test(buf)) {
            block(authority, 'recusado pelo proxy upstream');
            clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            remote.destroy();
            return;
          }
          startPipe();
        };
        remote.on('data', onData);
      });
    } else {
      remote.once('connect', startPipe);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    blocked,
    bytesIn: () => bytesIn,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
