import { useState } from 'react';
import type { DashboardStats } from '@shared/types';
import { shortDate } from '../../lib/format';
import { useWidth } from './useWidth';

type Point = DashboardStats['timeline'][number];

const SERIES = [
  { key: 'ui' as const, label: 'UI', color: 'var(--series-ui)' },
  { key: 'ux' as const, label: 'UX', color: 'var(--series-ux)' },
];

/** Evolução das notas médias de UI e UX por dia. Escala fixa 0–100. */
export function ScoreTrend({ data }: { data: Point[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const height = 220;
  const pad = { top: 12, right: 40, bottom: 26, left: 30 };
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.top + ih - (v / 100) * ih;
  const path = (k: 'ui' | 'ux') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const last = data[data.length - 1];

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    data.forEach((_, i) => {
      if (Math.abs(x(i) - pad.left - px) < Math.abs(x(best) - pad.left - px)) best = i;
    });
    setHover(best);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-muted" aria-label="Legenda">
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <button onClick={() => setAsTable((v) => !v)} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          {asTable ? 'Ver gráfico' : 'Ver como tabela'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-56 overflow-auto rounded-lg border border-line">
          <table className="tabular w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Dia</th>
                <th className="px-3 py-2 font-medium">UI</th>
                <th className="px-3 py-2 font-medium">UX</th>
                <th className="px-3 py-2 font-medium">Análises</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="px-3 py-1.5">{shortDate(d.date)}</td>
                  <td className="px-3 py-1.5">{d.ui}</td>
                  <td className="px-3 py-1.5">{d.ux}</td>
                  <td className="px-3 py-1.5">{d.analyses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative">
          <svg width={width} height={height} role="img" aria-label={`Evolução das notas médias de UI e UX em ${data.length} dias`}>
            {[0, 50, 100].map((v) => (
              <g key={v}>
                <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === 0 ? undefined : '2 4'} />
                <text x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="tabular fill-faint text-[11px]">
                  {v}
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              data.length <= 8 || i % Math.ceil(data.length / 6) === 0 || i === data.length - 1 ? (
                <text key={d.date} x={x(i)} y={height - 6} textAnchor="middle" className="fill-faint text-[11px]">
                  {shortDate(d.date)}
                </text>
              ) : null,
            )}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + ih} stroke="var(--line-strong)" />}
            {SERIES.map((s) => (
              <g key={s.key}>
                <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {data.length === 1 && <circle cx={x(0)} cy={y(data[0]![s.key])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
                {hover !== null && <circle cx={x(hover)} cy={y(data[hover]![s.key])} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
              </g>
            ))}
            {last &&
              SERIES.map((s, idx) => {
                // Rótulos diretos no fim das linhas; afasta se colidirem.
                const yy = y(last[s.key]);
                const other = y(last[SERIES[1 - idx]!.key]);
                const nudge = Math.abs(yy - other) < 12 ? (yy <= other ? -6 : 6) : 0;
                return (
                  <text key={s.key} x={x(data.length - 1) + 8} y={yy + nudge} dy="0.32em" className="tabular fill-ink-2 text-[11px] font-medium">
                    {s.label} {last[s.key]}
                  </text>
                );
              })}
            <rect x={pad.left} y={pad.top} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop"
              style={{ left: Math.min(Math.max(x(hover) - 72, 0), width - 150), top: 0 }}
            >
              <div className="mb-1 font-medium">{shortDate(data[hover]!.date)}</div>
              {SERIES.map((s) => (
                <div key={s.key} className="tabular flex items-center justify-between gap-4 text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-medium text-ink">{data[hover]![s.key]}</span>
                </div>
              ))}
              <div className="mt-1 text-faint">{data[hover]!.analyses} análise(s)</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
