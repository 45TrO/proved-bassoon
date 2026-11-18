import { LayoutDashboard, Star } from 'lucide-react';
import { Link } from 'react-router';
import { CATEGORY_LABELS, type IssueCategory } from '@shared/types';
import { BarList, SeverityStack, Sparkline } from '../components/charts/Bars';
import { ScoreTrend } from '../components/charts/ScoreTrend';
import { PageHeader } from '../components/layout/AppShell';
import { EmptyState, ErrorNotice, Skeleton } from '../components/ui/Empty';
import { ScoreRing } from '../components/ui/ScoreRing';
import { api } from '../lib/api';
import { pluralize, relativeTime, scoreTone, toneColor } from '../lib/format';
import { useAsync, useDocumentTitle } from '../lib/hooks';

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-5 ${className}`}>
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function DashboardPage() {
  useDocumentTitle('Painel');
  const q = useAsync(() => api.dashboard(), []);
  const d = q.data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader title="Painel" description="Visão consolidada de todas as análises concluídas." />
      {q.error && <ErrorNotice error={q.error} onRetry={q.reload} />}
      {q.loading && (
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
          <Skeleton className="h-72 md:col-span-4" />
        </div>
      )}
      {d && d.analyses === 0 && (
        <div className="rounded-xl border border-dashed border-line">
          <EmptyState icon={<LayoutDashboard size={18} />} title="O painel aparece após a primeira análise" action={<Link to="/" className="tap text-sm font-medium text-inspect hover:underline">Analisar uma interface</Link>}>
            As médias, a evolução das notas e a distribuição dos problemas são calculadas a partir das análises concluídas.
          </EmptyState>
        </div>
      )}
      {d && d.analyses > 0 && (
        <div className="space-y-4">
          <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
            <div className="flex items-center gap-4 bg-surface p-5">
              <ScoreRing value={d.avgOverall} size={72} stroke={5} label="Nota média geral" />
              <div>
                <p className="text-xs text-muted">Nota média geral</p>
                <p className="tabular mt-0.5 text-sm">
                  UI <span className="font-semibold">{d.avgUi}</span>
                  <span aria-hidden="true" className="mx-2 inline-block h-3 w-px translate-y-0.5 bg-line-strong" />
                  UX <span className="font-semibold">{d.avgUx}</span>
                </p>
              </div>
            </div>
            {[
              ['Projetos analisados', d.projects, `${d.analyses} análises`],
              ['Problemas identificados', d.issuesFound, 'em todas as análises'],
              ['Melhorias implementadas', d.issuesImplemented, d.issuesFound ? `${Math.round((d.issuesImplemented / d.issuesFound) * 100)}% dos problemas` : '—'],
            ].map(([label, value, sub]) => (
              <div key={label as string} className="bg-surface p-5">
                <p className="text-xs text-muted">{label}</p>
                <p className="tabular mt-1 text-2xl font-semibold tracking-tight">{(value as number).toLocaleString('pt-BR')}</p>
                <p className="mt-0.5 text-xs text-faint">{sub}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Panel title="Evolução das notas médias">
              <ScoreTrend data={d.timeline} />
            </Panel>
            <Panel title="Problemas por categoria">
              <BarList items={(Object.keys(d.byCategory) as IssueCategory[]).map((c) => ({ label: CATEGORY_LABELS[c], value: d.byCategory[c] })).sort((a, b) => b.value - a.value)} />
            </Panel>
          </div>

          <Panel title="Problemas por severidade">
            <SeverityStack counts={d.bySeverity} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Panel title="Histórico de análises">
              <div className="-mx-5 -mb-5 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="border-y border-line bg-surface-2/60 text-xs text-muted">
                    <tr>
                      <th className="px-5 py-2 font-medium">Projeto</th>
                      <th className="px-3 py-2 font-medium">Geral</th>
                      <th className="px-3 py-2 font-medium">UI</th>
                      <th className="px-3 py-2 font-medium">UX</th>
                      <th className="px-3 py-2 font-medium">Problemas</th>
                      <th className="px-5 py-2 text-right font-medium">Quando</th>
                    </tr>
                  </thead>
                  <tbody className="tabular divide-y divide-line">
                    {d.recent.map((a) => (
                      <tr key={a.id} className="hover:bg-surface-2/50">
                        <td className="max-w-56 truncate px-5 py-2.5">
                          <Link to={`/analises/${a.id}`} className="tap font-medium hover:text-inspect">
                            {a.projectName}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 font-semibold" style={{ color: toneColor[scoreTone(a.overall)] }}>
                          {a.overall ?? '—'}
                        </td>
                        <td className="px-3 py-2.5">{a.ui ?? '—'}</td>
                        <td className="px-3 py-2.5">{a.ux ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          {a.issueCount}
                          {a.implementedCount > 0 && <span className="ml-1 text-xs text-ok">({a.implementedCount} corrigidos)</span>}
                        </td>
                        <td className="px-5 py-2.5 text-right text-muted">{relativeTime(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="Projetos favoritos">
              {d.favorites.length === 0 ? (
                <p className="text-sm text-muted">
                  Marque projetos com <Star size={13} className="inline align-[-2px]" /> para acompanhá-los aqui.
                </p>
              ) : (
                <ul className="-mx-2 space-y-0.5">
                  {d.favorites.map((p) => (
                    <li key={p.id}>
                      <Link to={`/projetos/${p.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          <span className="text-xs text-muted">{pluralize(p.analysisCount, 'análise', 'análises')}</span>
                        </span>
                        <Sparkline values={p.trend} />
                        <span className="tabular w-7 text-right text-sm font-semibold" style={{ color: toneColor[scoreTone(p.lastOverall)] }}>
                          {p.lastOverall ?? '—'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
