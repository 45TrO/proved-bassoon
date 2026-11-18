import { scoreTone, toneColor } from '../../lib/format';

interface Props {
  value: number | null;
  size?: number;
  stroke?: number;
  label?: string;
}

/** Medidor circular da nota. A cor segue as faixas: ≥85 boa, ≥60 regular, <60 ruim. */
export function ScoreRing({ value, size = 96, stroke = 6, label }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const color = toneColor[scoreTone(value)];
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={label ? `${label}: ${value ?? 'sem nota'} de 100` : undefined}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <span className="tabular absolute font-semibold tracking-tight" style={{ fontSize: size * 0.3 }}>
        {value ?? '—'}
      </span>
    </div>
  );
}
