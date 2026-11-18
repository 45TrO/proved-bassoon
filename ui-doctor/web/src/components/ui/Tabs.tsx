import { clsx } from 'clsx';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  count?: number;
}

/** Abas acessíveis (setas, Home/End) com indicador sublinhado. */
export function Tabs<K extends string>({ items, value, onChange, label, size = 'md' }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string; size?: 'sm' | 'md' }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, idx: number) => {
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    e.preventDefault();
    onChange(items[next]!.key);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
      {items.map((it, idx) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(it.key)}
            onKeyDown={(e) => onKey(e, idx)}
            className={clsx(
              'relative shrink-0 rounded-md font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-2 text-sm',
              active ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {it.label}
              {it.count !== undefined && <span className="tabular rounded bg-surface-2 px-1.5 text-2xs text-muted">{it.count}</span>}
            </span>
            <span className={clsx('absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
          </button>
        );
      })}
    </div>
  );
}
