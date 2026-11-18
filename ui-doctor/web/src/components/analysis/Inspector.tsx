import { clsx } from 'clsx';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Capture, Issue, Rect } from '@shared/types';
import { fileUrl } from '../../lib/api';
import { severityColor } from '../../lib/format';
import { useWidth } from '../charts/useWidth';

interface Box {
  issue: Issue;
  rect: Rect;
  key: string;
}

interface Props {
  analysisId: string;
  capture: Capture;
  issues: Issue[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Screenshot real com as evidências desenhadas como caixas de medição.
 * Selecionar um problema escurece o resto da página (spotlight) e mostra a
 * dimensão medida de cada elemento.
 */
export function Inspector({ analysisId, capture, issues, selectedId, onSelect }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>(900);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [actualSize, setActualSize] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scale = actualSize ? 1 : Math.min(1, width / capture.width);
  const imgH = capture.fullHeight * scale;

  const boxes = useMemo<Box[]>(() => {
    const out: Box[] = [];
    for (const issue of issues) {
      issue.evidence.forEach((ev, idx) => {
        if (ev.viewport !== capture.viewport || !ev.rect) return;
        const r = ev.rect;
        if (r.y >= capture.fullHeight || r.width <= 0 || r.height <= 0) return;
        out.push({ issue, rect: r, key: `${issue.id}-${idx}` });
      });
    }
    return out;
  }, [issues, capture]);

  const selected = boxes.filter((b) => b.issue.id === selectedId);

  // Etiquetas de dimensão: tenta acima da caixa, depois abaixo; se colidir com outra, omite.
  const labelPos = useMemo(() => {
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const out = new Map<string, 'top' | 'bottom'>();
    const LH = 18;
    for (const b of [...selected].sort((a, c) => a.rect.y - c.rect.y || a.rect.x - c.rect.x)) {
      const text = `${Math.round(b.rect.width)} × ${Math.round(b.rect.height)}`;
      const w = text.length * 6.6 + 12;
      const x = b.rect.x * scale - 2;
      const candidates: ['top' | 'bottom', number][] = [
        ['top', b.rect.y * scale - LH - 4],
        ['bottom', (b.rect.y + b.rect.height) * scale + 4],
      ];
      for (const [pos, y] of candidates) {
        if (y < 0) continue;
        const hit = placed.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + LH > r.y);
        if (!hit) {
          placed.push({ x, y, w, h: LH });
          out.set(b.key, pos);
          break;
        }
      }
    }
    return out;
  }, [selected, scale]);
  const outOfView = selectedId ? issues.find((i) => i.id === selectedId)?.evidence.filter((e) => e.viewport === capture.viewport && e.rect && e.rect.y >= capture.fullHeight).length ?? 0 : 0;

  // Leva a primeira evidência do problema selecionado para a área visível.
  useEffect(() => {
    const first = selected[0];
    const el = scrollRef.current;
    if (!first || !el) return;
    const top = first.rect.y * scale - el.clientHeight / 3;
    el.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, capture.viewport, scale]);

  useEffect(() => setLoaded(false), [capture.file]);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-xs text-muted">
        <span className="tabular">
          {capture.width} × {capture.fullHeight}px
          {capture.documentHeight && capture.documentHeight > capture.fullHeight ? ` de ${capture.documentHeight}px` : ''}
          <span aria-hidden="true" className="mx-2 inline-block h-3 w-px translate-y-0.5 bg-line-strong" />
          {boxes.length} marcações
        </span>
        <button
          onClick={() => setActualSize((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-surface-2 hover:text-ink"
          aria-pressed={actualSize}
        >
          {actualSize ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          {actualSize ? 'Ajustar à largura' : 'Tamanho real'}
        </button>
      </div>
      <div ref={wrapRef}>
        <div ref={scrollRef} className="relative max-h-[72vh] overflow-auto bg-surface-2 [scrollbar-gutter:stable]">
          <div className="relative mx-auto" style={{ width: capture.width * scale, height: imgH }}>
            {!loaded && <div className="absolute inset-0 animate-pulse bg-surface-2" />}
            <img
              src={fileUrl(analysisId, capture.file)}
              alt={`Captura da interface em ${capture.width}px de largura`}
              width={capture.width * scale}
              height={imgH}
              onLoad={() => setLoaded(true)}
              className="block select-none"
              draggable={false}
            />
            <svg className="absolute inset-0" width={capture.width * scale} height={imgH} aria-hidden="true">
              {selected.length > 0 && (
                <>
                  <defs>
                    <mask id={`spot-${capture.viewport}`}>
                      <rect width="100%" height="100%" fill="white" />
                      {selected.map((b) => (
                        <rect key={b.key} x={b.rect.x * scale - 4} y={b.rect.y * scale - 4} width={b.rect.width * scale + 8} height={b.rect.height * scale + 8} rx={4} fill="black" />
                      ))}
                    </mask>
                  </defs>
                  <rect width="100%" height="100%" fill="rgb(15 17 21 / 0.45)" mask={`url(#spot-${capture.viewport})`} />
                </>
              )}
            </svg>
            {boxes.map((b) => {
              const isSel = b.issue.id === selectedId;
              const dim = selectedId !== null && !isSel;
              const color = severityColor[b.issue.severity];
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onSelect(isSel ? null : b.issue.id)}
                  aria-label={`${b.issue.title}${b.issue.evidence[0]?.snippet ? `: ${b.issue.evidence[0].snippet}` : ''}`}
                  className={clsx('absolute rounded-[3px] transition-[opacity,box-shadow] duration-200', dim ? 'opacity-0 hover:opacity-60' : 'opacity-100')}
                  style={{
                    left: b.rect.x * scale,
                    top: b.rect.y * scale,
                    width: Math.max(6, b.rect.width * scale),
                    height: Math.max(6, b.rect.height * scale),
                    border: `${isSel ? 2 : 1.5}px solid ${color}`,
                    background: isSel ? 'transparent' : `color-mix(in srgb, ${color} 8%, transparent)`,
                    boxShadow: isSel ? `0 0 0 3px color-mix(in srgb, ${color} 25%, transparent)` : undefined,
                  }}
                >
                  {isSel && labelPos.has(b.key) && (
                    <span
                      className={clsx(
                        'tabular pointer-events-none absolute left-[-2px] rounded-[3px] px-1.5 py-0.5 font-mono text-[10.5px] leading-none whitespace-nowrap text-white',
                        labelPos.get(b.key) === 'top' ? '-top-[22px]' : '-bottom-[22px]',
                      )}
                      style={{ background: color }}
                    >
                      {Math.round(b.rect.width)} × {Math.round(b.rect.height)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {outOfView > 0 && (
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          {outOfView === 1 ? '1 evidência deste problema está abaixo da área capturada.' : `${outOfView} evidências deste problema estão abaixo da área capturada.`}
        </p>
      )}
    </div>
  );
}
