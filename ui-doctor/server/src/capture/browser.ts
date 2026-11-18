import { chromium, type Browser } from 'playwright';
import type { AppConfig } from '../config.js';

let browserPromise: Promise<Browser> | null = null;

/**
 * Flags que fecham caminhos de rede que não passam pelo proxy de saída:
 * - QUIC/HTTP3 usa UDP e não passa pelo proxy HTTP.
 * - WebRTC pode abrir conexões UDP diretas para IPs internos.
 * - Prefetch de DNS e rede em segundo plano geram tráfego fora da análise.
 */
export const HARDENING_ARGS = [
  '--disable-quic',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--dns-prefetch-disable',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-sync',
  '--no-first-run',
  '--no-pings',
  '--mute-audio',
  '--disable-features=MediaRouter,OptimizationHints,Translate,InterestFeedContentSuggestions',
];

export function getBrowser(config: AppConfig): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        chromiumSandbox: config.chromiumSandbox,
        executablePath: config.chromiumExecutable,
        args: HARDENING_ARGS,
        // Proxy global obrigatório: cada contexto define o seu (proxy por análise).
        // "<-loopback>" remove a exceção implícita do Chromium para localhost.
        proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>' },
      })
      .then((b) => {
        b.on('disconnected', () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => undefined);
}
