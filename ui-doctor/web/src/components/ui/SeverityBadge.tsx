import { SEVERITY_LABELS, type Severity } from '@shared/types';
import { severityColor } from '../../lib/format';

/** Severidade: forma (barras) + cor + texto, nunca só cor. */
export function SeverityBadge({ severity, compact = false }: { severity: Severity; compact?: boolean }) {
  const level = { critical: 4, high: 3, medium: 2, low: 1 }[severity];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: severityColor[severity] }}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="w-[3px] rounded-[1px]" style={{ height: 3 + i * 2, background: i <= level ? 'currentColor' : 'var(--line-strong)' }} />
        ))}
      </span>
      {compact ? <span className="sr-only">{SEVERITY_LABELS[severity]}</span> : SEVERITY_LABELS[severity]}
    </span>
  );
}
