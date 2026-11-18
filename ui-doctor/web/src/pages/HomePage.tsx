import { Image as ImageIcon, ScanSearch } from 'lucide-react';
import { Link } from 'react-router';
import type { AnalysisSummary } from '@shared/types';
import { AnalyzeForm } from '../components/analysis/AnalyzeForm';
import { EmptyState, ErrorNotice, Skeleton } from '../components/ui/Empty';
import { api, fileUrl } from '../lib/api';
import { pluralize, relativeTime, scoreTone, toneColor } from '../lib/format';
import { useAsync, useDocumentTitle } from '../lib/hooks';

const STATUS_LABEL: Record<AnalysisSummary['status'], string> = {
  queued: 'Na fila',
  capturing: 'Capturando',
  analyzing: 'Analisando',
  scoring: 'Finalizando',
  done: 'Concluída',
  failed: 'Falhou',
};

export function AnalysisThumb({ a }: { a: AnalysisSummary }) {
  return (
    <Link to={`/analises/${a.id}`} className="group block rounded-xl border border-line bg-surface p-1.5 transition-colors hover:border-line-strong">
      <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-surface-2">
        {a.thumbnail ? (
          <img src={fileUrl(a.id, a.thumbnail)} alt="" loading="lazy" className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.02]" />
        ) : (
          <div className="grid h-full place-items-center text-faint">{a.sourceType === 'image' ? <ImageIcon size={20} /> : <ScanSearch size={20} />}</div>
        )}
        {a.overall !== null && (
          <span className="tabular absolute right-2 bottom-2 rounded-md bg-surface/95 px-1.5 py-0.5 text-xs font-semibold shadow-pop" style={{ color: toneColor[scoreTone(a.overall)] }}>
            {a.overall}
          </span>
        )}
      </div>
      <div className="px-1.5 pt-2.5 pb-1">
        <p className="truncate text-sm font-medium">{a.projectName}</p>
        <p className="mt-0.5 flex justify-between gap-2 text-xs text-muted">
          <span>{a.status === 'done' ? pluralize(a.issueCount, 'problema', 'problemas') : STATUS_LABEL[a.status]}</span>
          <span>{relativeTime(a.createdAt)}</span>
        </p>
      </div>
    </Link>
  );
}

export function HomePage() {
  useDocumentTitle('Nova análise');
  const stats = useAsync(() => api.dashboard(), []);
  const d = stats.data;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-14 pb-20 sm:px-8 lg:pt-24">
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[2.6rem]">Descubra o que está atrapalhando a sua interface.</h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted">
          Informe um endereço. O UI Doctor abre a página em três resoluções, mede cada elemento e aponta os problemas no próprio screenshot, com os números que comprovam cada um.
        </p>
        <div className="mt-8 text-left">
          <AnalyzeForm />
        </div>
      </section>

      <section aria-labelledby="indicadores" className="mt-16">
        <h2 id="indicadores" className="sr-only">
          Indicadores
        </h2>
        {stats.error ? (
          <ErrorNotice error={stats.error} onRetry={stats.reload} />
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ['Análises', d?.analyses],
              ['UI média', d?.avgUi],
              ['UX média', d?.avgUx],
              ['Problemas corrigidos', d ? `${d.issuesImplemented} de ${d.issuesFound}` : undefined],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-line bg-surface px-3 py-3.5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="tabular mt-1 text-xl font-semibold tracking-tight">{stats.loading ? <Skeleton className="h-6 w-12" /> : (value ?? '—')}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="recentes" className="mt-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="recentes" className="text-[15px] font-semibold">
            Análises recentes
          </h2>
          {d && d.recent.length > 0 && (
            <Link to="/projetos" className="tap text-sm text-muted hover:text-ink">
              Ver projetos
            </Link>
          )}
        </div>
        {stats.loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-[4/3]" />
            ))}
          </div>
        ) : d && d.recent.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {d.recent.map((a, i) => (
              <div key={a.id} className={i >= 4 ? 'hidden lg:block' : undefined}>
                <AnalysisThumb a={a} />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line">
            <EmptyState icon={<ScanSearch size={18} />} title="Nenhuma análise ainda">
              A primeira análise aparece aqui com a captura da página e a nota.
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}
