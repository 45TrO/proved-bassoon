import { clsx } from 'clsx';
import { Check, ChevronDown, CircleSlash, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABELS, type Issue, type IssueCategory, type IssueStatus, type Severity } from '@shared/types';
import { SeverityBadge } from '../ui/SeverityBadge';

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
const VIEWPORT_LABEL: Record<string, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile', image: 'Imagem' };

export interface IssueFilters {
  category: IssueCategory | 'all';
  severity: Severity | 'all';
  showClosed: boolean;
}

export function filterIssues(issues: Issue[], f: IssueFilters): Issue[] {
  return issues.filter(
    (i) =>
      (f.category === 'all' || i.category === f.category) &&
      (f.severity === 'all' || i.severity === f.severity) &&
      (f.showClosed || (i.status ?? 'open') === 'open'),
  );
}

function formatKey(k: string): string {
  const map: Record<string, string> = {
    ratio: 'Contraste',
    required: 'Mínimo exigido',
    foreground: 'Cor do texto',
    background: 'Cor de fundo',
    suggestedColor: 'Cor sugerida',
    fontSize: 'Tamanho da fonte',
    size: 'Dimensão',
    minimum: 'Referência',
    overflow: 'Vazamento',
    width: 'Largura',
    viewport: 'Largura da tela',
    offset: 'Desvio',
    left: 'Borda esquerda',
    expectedLeft: 'Linha de alinhamento',
    gaps: 'Espaços medidos',
    spread: 'Variação',
    words: 'Palavras',
    interactive: 'Elementos interativos',
    fields: 'Campos',
    lineHeight: 'Altura de linha',
    approxCharsPerLine: 'Caracteres por linha',
    borderRadius: 'Raio da borda',
    height: 'Altura',
  };
  return map[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function MeasuredValue({ k, v }: { k: string; v: string | number | boolean }) {
  const isColor = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  const display = typeof v === 'boolean' ? (v ? 'sim' : 'não') : k === 'ratio' || k === 'required' ? `${v}:1` : String(v);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink">
      {isColor && <span className="size-3 rounded-[3px] border border-line" style={{ background: v as string }} />}
      {display}
    </span>
  );
}

function IssueDetail({ issue, onStatus, busy }: { issue: Issue; onStatus: (s: IssueStatus) => void; busy: boolean }) {
  const status = issue.status ?? 'open';
  return (
    <div className="animate-rise space-y-4 px-4 pt-1 pb-4">
      <p className="text-sm leading-relaxed text-ink-2">{issue.description}</p>
      <div className="rounded-lg border border-line bg-surface-2/60 p-3">
        <p className="mb-1 text-xs font-medium text-muted">Recomendação</p>
        <p className="text-sm leading-relaxed">{issue.recommendation}</p>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-muted">
          Evidências
          {issue.occurrences > issue.evidence.length && <span className="font-normal"> — exibindo {issue.evidence.length} de {issue.occurrences}</span>}
        </p>
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {issue.evidence.map((ev, idx) => (
            <li key={idx} className="space-y-1.5 bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">{VIEWPORT_LABEL[ev.viewport] ?? ev.viewport}</span>
                {ev.snippet && <span className="max-w-full truncate text-ink-2">“{ev.snippet}”</span>}
              </div>
              {ev.selector && <code className="block truncate font-mono text-[11px] text-faint" title={ev.selector}>{ev.selector}</code>}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {Object.entries(ev.measured).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-xs text-muted">{formatKey(k)}</dt>
                    <dd className="min-w-0 break-words">
                      <MeasuredValue k={k} v={v} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        {status === 'open' ? (
          <>
            <button disabled={busy} onClick={() => onStatus('implemented')} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[13px] font-medium hover:border-line-strong disabled:opacity-50">
              <Check size={14} className="text-ok" /> Marcar como corrigido
            </button>
            <button disabled={busy} onClick={() => onStatus('dismissed')} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50">
              <CircleSlash size={14} /> Descartar
            </button>
          </>
        ) : (
          <button disabled={busy} onClick={() => onStatus('open')} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[13px] font-medium hover:border-line-strong disabled:opacity-50">
            <RotateCcw size={14} /> Reabrir
          </button>
        )}
      </div>
    </div>
  );
}

interface ListProps {
  issues: Issue[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onStatus: (issue: Issue, status: IssueStatus) => Promise<void>;
}

export function IssueList({ issues, selectedId, onSelect, onStatus }: ListProps) {
  const [filters, setFilters] = useState<IssueFilters>({ category: 'all', severity: 'all', showClosed: false });
  const [busy, setBusy] = useState<string | null>(null);
  const visible = useMemo(() => filterIssues(issues, filters), [issues, filters]);
  const counts = useMemo(() => {
    const c: Partial<Record<IssueCategory, number>> = {};
    for (const i of issues) if ((i.status ?? 'open') === 'open') c[i.category] = (c[i.category] ?? 0) + 1;
    return c;
  }, [issues]);
  const closed = issues.filter((i) => (i.status ?? 'open') !== 'open').length;
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (selectedId) itemRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Filtrar por categoria">
        {(['all', 'visual', 'ux', 'accessibility', 'responsive', 'identity'] as const).map((c) => {
          const n = c === 'all' ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : (counts[c] ?? 0);
          return (
            <button
              key={c}
              aria-pressed={filters.category === c}
              onClick={() => setFilters((f) => ({ ...f, category: c }))}
              className={clsx(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                filters.category === c ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-muted hover:text-ink',
              )}
            >
              {c === 'all' ? 'Todos' : CATEGORY_LABELS[c]}
              <span className="tabular opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          Severidade
          <select
            value={filters.severity}
            onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value as IssueFilters['severity'] }))}
            className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs text-ink"
          >
            <option value="all">Todas</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {{ critical: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa' }[s]}
              </option>
            ))}
          </select>
        </label>
        {closed > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={filters.showClosed} onChange={(e) => setFilters((f) => ({ ...f, showClosed: e.target.checked }))} className="accent-[var(--inspect)]" />
            Mostrar resolvidos ({closed})
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          {issues.length === 0 ? 'Nenhum problema detectado nesta análise.' : 'Nenhum problema com esses filtros.'}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {visible.map((issue) => {
            const open = issue.id === selectedId;
            const status = issue.status ?? 'open';
            return (
              <li
                key={issue.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(issue.id, el);
                  else itemRefs.current.delete(issue.id);
                }}
                className={clsx('transition-colors', open && 'bg-surface-2/50')}
              >
                <button
                  onClick={() => onSelect(open ? null : issue.id)}
                  aria-expanded={open}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2/60"
                >
                  <span className="mt-0.5 w-16 shrink-0">
                    <SeverityBadge severity={issue.severity} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={clsx('block text-sm font-medium', status !== 'open' && 'text-muted line-through decoration-faint')}>{issue.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      <span>{CATEGORY_LABELS[issue.category]}</span>
                      {issue.occurrences > 1 && <span className="tabular">{issue.occurrences} ocorrências</span>}
                      {issue.source === 'ai' && (
                        <span className="inline-flex items-center gap-1 text-inspect">
                          <Sparkles size={11} /> IA
                        </span>
                      )}
                      {issue.fixable && status === 'open' && (
                        <span className="inline-flex items-center gap-1">
                          <Wand2 size={11} /> correção automática
                        </span>
                      )}
                      {status === 'implemented' && <span className="text-ok">Corrigido</span>}
                      {status === 'dismissed' && <span>Descartado</span>}
                    </span>
                  </span>
                  <ChevronDown size={16} className={clsx('mt-0.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
                </button>
                {open && (
                  <IssueDetail
                    issue={issue}
                    busy={busy === issue.id}
                    onStatus={async (s) => {
                      setBusy(issue.id);
                      try {
                        await onStatus(issue, s);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
