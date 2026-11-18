import { lookup } from 'node:dns/promises';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

export class UrlRejectedError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_url'
      | 'scheme'
      | 'credentials'
      | 'port'
      | 'host'
      | 'private_address'
      | 'dns'
      | 'length',
  ) {
    super(message);
    this.name = 'UrlRejectedError';
  }
}

export interface GuardOptions {
  /**
   * Pares "host:porta" liberados explicitamente mesmo sendo privados.
   * Uso exclusivo para testes e desenvolvimento local (UIDOCTOR_ALLOW_PRIVATE_HOSTS).
   */
  allowPrivate?: ReadonlySet<string>;
  allowedPorts?: ReadonlySet<number>;
  resolver?: (host: string) => Promise<string[]>;
}

export const DEFAULT_PORTS: ReadonlySet<number> = new Set([80, 443, 8080, 8443]);
const MAX_URL_LENGTH = 2048;

/** Nomes que nunca devem ser acessados, independentemente do DNS. */
const BLOCKED_HOSTNAMES = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.intranet$/i,
  /\.lan$/i,
  /\.home\.arpa$/i,
  /^metadata(\.google\.internal)?$/i,
  /\.svc(\.cluster\.local)?$/i,
];

/**
 * Faixas de IP permitidas: somente "unicast" público.
 * Tudo que ipaddr.js classifica de outra forma (private, loopback, linkLocal,
 * carrierGradeNat, uniqueLocal, multicast, reserved, unspecified, broadcast,
 * 6to4, teredo, rfc6052, benchmarking, amt, as112, orchid2...) é recusado.
 */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) parsed = v6.toIPv4Address();
  }
  const range = parsed.range();
  if (range !== 'unicast') return false;
  if (parsed.kind() === 'ipv4') {
    const octets = (parsed as ipaddr.IPv4).octets;
    // Faixas não cobertas por ipaddr.js como especiais:
    if (octets[0] === 0) return false; // "this network"
    if (octets[0] === 192 && octets[1] === 0 && octets[2] === 0) return false; // IETF protocol assignments
    if (octets[0] === 192 && octets[1] === 0 && octets[2] === 2) return false; // TEST-NET-1
    if (octets[0] === 198 && octets[1] === 51 && octets[2] === 100) return false; // TEST-NET-2
    if (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) return false; // TEST-NET-3
    if (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) return false; // benchmarking
    if (octets[0] >= 240) return false; // reservado / broadcast
  } else {
    const parts = (parsed as ipaddr.IPv6).parts as number[] & { 0: number; 1: number };
    // 64:ff9b::/96 (NAT64) pode embutir IPv4 interno; 2001:db8::/32 documentação.
    if (parts[0] === 0x64 && parts[1] === 0xff9b) return false;
    if (parts[0] === 0x2001 && parts[1] === 0x0db8) return false;
  }
  return true;
}

export function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

function defaultPort(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

export interface ParsedTarget {
  url: URL;
  host: string;
  port: number;
}

/** Validação estática (sem rede): forma, esquema, credenciais, porta e nome. */
export function parseTargetUrl(raw: string, opts: GuardOptions = {}): ParsedTarget {
  const input = raw.trim();
  if (input.length === 0) throw new UrlRejectedError('Informe uma URL.', 'invalid_url');
  if (input.length > MAX_URL_LENGTH) throw new UrlRejectedError('URL longa demais.', 'length');

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UrlRejectedError('URL inválida.', 'invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlRejectedError('Apenas URLs http:// e https:// são aceitas.', 'scheme');
  }
  if (url.username || url.password) {
    throw new UrlRejectedError('URLs com credenciais embutidas não são aceitas.', 'credentials');
  }
  const host = normalizeHostname(url.hostname);
  if (!host) throw new UrlRejectedError('URL sem host.', 'invalid_url');
  const port = url.port ? Number(url.port) : defaultPort(url.protocol);
  const allowPrivate = opts.allowPrivate?.has(`${host}:${port}`) ?? false;
  const ports = opts.allowedPorts ?? DEFAULT_PORTS;
  if (!allowPrivate && !ports.has(port)) {
    throw new UrlRejectedError(`Porta ${port} não permitida.`, 'port');
  }
  if (!allowPrivate) {
    if (BLOCKED_HOSTNAMES.some((re) => re.test(host))) {
      throw new UrlRejectedError('Endereços internos não podem ser analisados.', 'host');
    }
    // O parser WHATWG já normaliza 0x7f.1, 2130706433, 017700000001 etc. para IPv4 canônico.
    if (net.isIP(host) && !isPublicAddress(host)) {
      throw new UrlRejectedError('Endereços IP privados ou reservados não podem ser analisados.', 'private_address');
    }
    if (!net.isIP(host) && !host.includes('.')) {
      throw new UrlRejectedError('Informe um domínio público completo (ex.: exemplo.com).', 'host');
    }
  }
  url.hash = '';
  return { url, host, port };
}

async function defaultResolver(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

/**
 * Resolve o host e garante que TODOS os endereços sejam públicos.
 * Retorna o primeiro endereço válido para conexão com IP fixado.
 */
export async function resolvePublicAddress(
  host: string,
  port: number,
  opts: GuardOptions = {},
): Promise<string> {
  const allowPrivate = opts.allowPrivate?.has(`${host}:${port}`) ?? false;
  if (net.isIP(host)) {
    if (!allowPrivate && !isPublicAddress(host)) {
      throw new UrlRejectedError('Endereço IP privado ou reservado bloqueado.', 'private_address');
    }
    return host;
  }
  let addresses: string[];
  try {
    addresses = await (opts.resolver ?? defaultResolver)(host);
  } catch {
    throw new UrlRejectedError(`Não foi possível resolver o domínio ${host}.`, 'dns');
  }
  if (addresses.length === 0) throw new UrlRejectedError(`Domínio ${host} sem endereços.`, 'dns');
  if (!allowPrivate) {
    const bad = addresses.find((a) => !isPublicAddress(a));
    if (bad) {
      throw new UrlRejectedError(
        `O domínio ${host} aponta para um endereço interno e foi bloqueado.`,
        'private_address',
      );
    }
  }
  return addresses[0]!;
}

/** Validação completa: estática + DNS. */
export async function assertSafeUrl(raw: string, opts: GuardOptions = {}): Promise<ParsedTarget & { address: string }> {
  const target = parseTargetUrl(raw, opts);
  const address = await resolvePublicAddress(target.host, target.port, opts);
  return { ...target, address };
}

export function parseAllowList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}
