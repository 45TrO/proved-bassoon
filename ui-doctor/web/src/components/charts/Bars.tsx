import { useState } from 'react';
import { SEVERITY_LABELS, type Severity } from '@shared/types';
import { severityColor } from '../../lib/format';
import { SeverityBadge } from '../ui/SeverityBadge';

/** Barras horizontais de magnitude (uma série, um matiz). */
export function BarList({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const [hover, setHover] = useState<string | null>(null);
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.label} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-sm" onPointerEnter={() => setHover(it.label)} onPointerLeave={() => setHover(null)}>
          <span className="truncate text-muted">{it.label}</span>
          <span className="h-2 rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full transition-[width,opacity] duration-500"
              style={{ width: `${(it.value / max) * 100}%`, minWidth: it.value ? 4 : 0, background: 'var(--series-ui)', opacity: hover && hover !== it.label ? 0.45 : 1 }}
            />
          </span>
          <span className="tabular text-right font-medium">{it.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Barra empilhada de severidades com legenda rotulada (nunca só cor). */
export function SeverityStack({ counts }: { counts: Record<Severity, number> }) {
  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  const total = order.reduce((a, s) => a + counts[s], 0);
  const [hover, setHover] = useState<Severity | null>(null);
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-surface-2" role="img" aria-label={order.map((s) => `${SEVERITY_LABELS[s]}: ${counts[s]}`).join(', ')}>
        {total > 0 &&
          order.map((s) =>
            counts[s] ? (
              <span
                key={s}
                title={`${SEVERITY_LABELS[s]}: ${counts[s]}`}
                onPointerEnter={() => setHover(s)}
                onPointerLeave={() => setHover(null)}
                className="h-full transition-opacity first:rounded-l-full last:rounded-r-full"
                style={{ flexGrow: counts[s], background: severityColor[s], opacity: hover && hover !== s ? 0.4 : 1 }}
              />
            ) : null,
          )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-4">
        {order.map((s) => (
          <div key={s} className="flex items-center justify-between gap-2 text-sm" onPointerEnter={() => setHover(s)} onPointerLeave={() => setHover(null)}>
            <dt>
              <SeverityBadge severity={s} />
            </dt>
            <dd className="tabular font-medium">
              {counts[s]}
              <span className="ml-1 text-xs font-normal text-faint">{total ? Math.round((counts[s] / total) * 100) : 0}%</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Tendência compacta da nota de um projeto (uma série, sem legenda). */
export function Sparkline({ values, width = 72, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-faint">—</span>;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const delta = values[values.length - 1]! - values[0]!;
  return (
    <svg width={width} height={height} role="img" aria-label={`Tendência: ${delta >= 0 ? '+' : ''}${delta} pontos`}>
      <path d={d} fill="none" stroke="var(--series-ui)" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={2.5} fill="var(--series-ui)" />
    </svg>
  );
}
