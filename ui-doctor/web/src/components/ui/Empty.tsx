import type { ReactNode } from 'react';

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 grid size-10 place-items-center rounded-xl border border-line bg-surface text-muted">{icon}</div>}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <p className="mt-1.5 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-critical/30 bg-critical/5 px-4 py-3 text-sm">
      <span className="text-ink">{error.message}</span>
      {onRetry && (
        <button onClick={onRetry} className="font-medium text-critical underline-offset-2 hover:underline">
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}
