import path from 'node:path';
import { parseAllowList } from './security/urlGuard.js';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  webDist: string | null;
  concurrency: number;
  allowPrivateHosts: Set<string>;
  upstreamProxy: string | undefined;
  chromiumSandbox: boolean;
  chromiumExecutable: string | undefined;
  navigationTimeoutMs: number;
  maxCaptureHeight: number;
  corsOrigin: string | undefined;
  rateLimitPerMinute: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = path.resolve(env.UIDOCTOR_DATA_DIR ?? path.join(process.cwd(), 'data'));
  return {
    port: int(env.PORT, 8787),
    host: env.HOST ?? '127.0.0.1',
    dataDir,
    webDist: env.UIDOCTOR_WEB_DIST ? path.resolve(env.UIDOCTOR_WEB_DIST) : null,
    concurrency: int(env.UIDOCTOR_CONCURRENCY, 2),
    allowPrivateHosts: parseAllowList(env.UIDOCTOR_ALLOW_PRIVATE_HOSTS),
    upstreamProxy: env.UIDOCTOR_UPSTREAM_PROXY || undefined,
    chromiumSandbox: bool(env.UIDOCTOR_CHROMIUM_SANDBOX, false),
    chromiumExecutable: env.UIDOCTOR_CHROMIUM_PATH || undefined,
    navigationTimeoutMs: int(env.UIDOCTOR_NAV_TIMEOUT_MS, 25_000),
    maxCaptureHeight: int(env.UIDOCTOR_MAX_CAPTURE_HEIGHT, 8000),
    corsOrigin: env.UIDOCTOR_CORS_ORIGIN || undefined,
    rateLimitPerMinute: int(env.UIDOCTOR_RATE_LIMIT, 20),
  };
}
