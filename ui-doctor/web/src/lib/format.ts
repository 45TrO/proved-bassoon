import type { Severity } from '@shared/types';

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'agora';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function hostOf(target: string): string {
  try {
    return new URL(target).host.replace(/^www\./, '');
  } catch {
    return target;
  }
}

/** Faixas da nota: mesmas usadas em todo o produto. */
export function scoreTone(score: number | null): 'good' | 'fair' | 'poor' | 'none' {
  if (score === null) return 'none';
  if (score >= 85) return 'good';
  if (score >= 60) return 'fair';
  return 'poor';
}

export const toneColor: Record<ReturnType<typeof scoreTone>, string> = {
  good: 'var(--ok)',
  fair: 'var(--sev-medium)',
  poor: 'var(--sev-critical)',
  none: 'var(--faint)',
};

export const severityColor: Record<Severity, string> = {
  critical: 'var(--sev-critical)',
  high: 'var(--sev-high)',
  medium: 'var(--sev-medium)',
  low: 'var(--sev-low)',
};

export function pluralize(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

/** Validação no cliente: mesma forma do servidor, sem consulta de DNS. */
export function validateUrlInput(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Informe o endereço da página.';
  if (/\s/.test(v)) return 'O endereço não pode conter espaços.';
  if (v.length > 2048) return 'Endereço longo demais.';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(v);
  if (hasScheme && !/^https?:\/\//i.test(v)) return 'Use um endereço http:// ou https://.';
  try {
    const u = new URL(hasScheme ? v : `https://${v}`);
    if (!u.hostname.includes('.') && !/^\[.*\]$/.test(u.hostname) && !/^\d+$/.test(u.hostname)) return 'Informe um domínio completo, como exemplo.com.br.';
  } catch {
    return 'Endereço inválido.';
  }
  return null;
}
