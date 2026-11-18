import type { Capture, Issue } from '@shared/types';
import { fileUrl } from '../../lib/api';
import { SeverityBadge } from '../ui/SeverityBadge';

const LABEL: Record<string, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };

/** As três resoluções lado a lado, cada uma com os problemas medidos nela. */
export function ResponsivePanel({ analysisId, captures, issues, onInspect }: { analysisId: string; captures: Capture[]; issues: Issue[]; onInspect: (viewport: Capture['viewport'], issueId: string) => void }) {
  return (
    <div className="grid gap-6 md:grid-cols-[1.6fr_1fr_0.75fr]">
      {captures.map((c) => {
        const own = issues.filter((i) => (i.status ?? 'open') === 'open' && i.evidence.some((e) => e.viewport === c.viewport));
        const responsive = own.filter((i) => i.category === 'responsive');
        return (
          <section key={c.viewport} className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">{LABEL[c.viewport] ?? c.viewport}</h3>
              <span className="tabular text-xs text-muted">{c.width}px</span>
            </div>
            <div className="h-[420px] overflow-y-auto rounded-xl border border-line bg-surface-2">
              <img src={fileUrl(analysisId, c.file)} alt={`Página em ${c.width}px`} loading="lazy" className="block w-full" />
            </div>
            <ul className="mt-3 space-y-1">
              {responsive.length === 0 ? (
                <li className="text-xs text-muted">Nenhum problema de responsividade nesta largura.</li>
              ) : (
                responsive.map((i) => (
                  <li key={i.id}>
                    <button onClick={() => onInspect(c.viewport, i.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2">
                      <SeverityBadge severity={i.severity} compact />
                      <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            {own.length > responsive.length && <p className="mt-1 px-2 text-xs text-faint">+ {own.length - responsive.length} outros problemas medidos nesta largura</p>}
          </section>
        );
      })}
    </div>
  );
}
