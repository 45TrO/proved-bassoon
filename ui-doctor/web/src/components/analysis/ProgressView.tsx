import { clsx } from 'clsx';
import { Check, CircleDashed, Minus, X } from 'lucide-react';
import type { ProgressStep } from '@shared/types';
import { Spinner } from '../ui/Spinner';

/** Etapas reais reportadas pelo servidor, com um quadro de varredura enquanto a página é capturada. */
export function ProgressView({ steps, target }: { steps: ProgressStep[]; target: string }) {
  return (
    <div className="grid items-start gap-8 md:grid-cols-[1fr_minmax(0,22rem)]">
      <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-line bg-surface" aria-hidden="true">
        <div className="flex h-7 items-center gap-1.5 border-b border-line px-3">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2 rounded-full bg-line-strong" />
          ))}
          <span className="ml-3 truncate font-mono text-[11px] text-faint">{target}</span>
        </div>
        <div className="space-y-3 p-6">
          <div className="h-3 w-1/3 rounded bg-surface-2" />
          <div className="h-6 w-2/3 rounded bg-surface-2" />
          <div className="h-3 w-1/2 rounded bg-surface-2" />
          <div className="grid grid-cols-3 gap-3 pt-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 rounded-lg border border-dashed border-line-strong" />
            ))}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-7 bottom-0 overflow-hidden">
          <div className="h-full w-full animate-[scan_2.4s_ease-in-out_infinite_alternate]">
            <div className="h-px w-full bg-inspect shadow-[0_0_24px_6px_var(--inspect-soft)]" />
          </div>
        </div>
      </div>
      <ol className="space-y-1" aria-live="polite">
        {steps.map((s) => (
          <li key={s.key} className={clsx('flex gap-3 rounded-lg px-3 py-2.5', s.state === 'active' && 'bg-surface shadow-[0_0_0_1px_var(--line)]')}>
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
              {s.state === 'done' && <Check size={16} className="text-ok" />}
              {s.state === 'active' && <Spinner size={15} className="text-inspect" />}
              {s.state === 'pending' && <CircleDashed size={15} className="text-faint" />}
              {s.state === 'skipped' && <Minus size={15} className="text-faint" />}
              {s.state === 'error' && <X size={16} className="text-critical" />}
            </span>
            <span className="min-w-0">
              <span className={clsx('block text-sm', s.state === 'pending' || s.state === 'skipped' ? 'text-muted' : 'font-medium')}>{s.label}</span>
              {s.detail && <span className={clsx('mt-0.5 block text-xs', s.state === 'error' ? 'text-critical' : 'text-muted')}>{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
