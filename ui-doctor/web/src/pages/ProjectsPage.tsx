import { clsx } from 'clsx';
import { FolderKanban, Image as ImageIcon, Search, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Sparkline } from '../components/charts/Bars';
import { PageHeader } from '../components/layout/AppShell';
import { EmptyState, ErrorNotice, Skeleton } from '../components/ui/Empty';
import { useToast } from '../components/ui/Toast';
import { api, fileUrl } from '../lib/api';
import { pluralize, relativeTime, scoreTone, toneColor } from '../lib/format';
import { useAsync, useDocumentTitle } from '../lib/hooks';

export function ProjectsPage() {
  useDocumentTitle('Projetos');
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [favorites, setFavorites] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const q = useAsync(() => api.projects({ favorites, q: debounced || undefined }), [favorites, debounced]);

  const toggleFav = async (id: string, value: boolean) => {
    q.setData((prev) => prev?.map((p) => (p.id === id ? { ...p, favorite: value } : p)) ?? prev);
    try {
      await api.updateProject(id, { favorite: value });
    } catch (err) {
      q.setData((prev) => prev?.map((p) => (p.id === id ? { ...p, favorite: !value } : p)) ?? prev);
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader title="Projetos" description="Cada endereço analisado vira um projeto com histórico de notas." />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Buscar projetos</span>
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou endereço"
            className="h-9 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-inspect"
          />
        </label>
        <button
          aria-pressed={favorites}
          onClick={() => setFavorites((v) => !v)}
          className={clsx('inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm', favorites ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-muted hover:text-ink')}
        >
          <Star size={14} className={favorites ? 'fill-current' : ''} /> Favoritos
        </button>
      </div>

      {q.error && <ErrorNotice error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      )}
      {q.data && q.data.length === 0 && (
        <div className="rounded-xl border border-dashed border-line">
          <EmptyState
            icon={<FolderKanban size={18} />}
            title={debounced || favorites ? 'Nenhum projeto encontrado' : 'Nenhum projeto ainda'}
            action={!debounced && !favorites ? <Link to="/" className="tap text-sm font-medium text-inspect hover:underline">Analisar uma interface</Link> : undefined}
          >
            {debounced || favorites ? 'Ajuste a busca ou o filtro de favoritos.' : 'Os projetos são criados automaticamente a cada nova análise.'}
          </EmptyState>
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((p) => (
            <li key={p.id} className="relative rounded-xl border border-line bg-surface p-1.5 transition-colors hover:border-line-strong">
              <Link to={`/projetos/${p.id}`} className="block">
                <div className="aspect-[16/9] overflow-hidden rounded-lg bg-surface-2">
                  {p.thumbnail && p.lastAnalysisId ? (
                    <img src={fileUrl(p.lastAnalysisId, p.thumbnail)} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
                  ) : (
                    <div className="grid h-full place-items-center text-faint">{p.sourceType === 'image' ? <ImageIcon size={20} /> : <FolderKanban size={20} />}</div>
                  )}
                </div>
                <div className="flex items-end justify-between gap-3 px-2 pt-3 pb-1.5">
                  <div className="min-w-0">
                    <p className="truncate pr-8 text-sm font-medium">{p.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {pluralize(p.analysisCount, 'análise', 'análises')}{p.lastAnalyzedAt ? ` · ${relativeTime(p.lastAnalyzedAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Sparkline values={p.trend} />
                    <span className="tabular text-lg font-semibold" style={{ color: toneColor[scoreTone(p.lastOverall)] }}>
                      {p.lastOverall ?? '—'}
                    </span>
                  </div>
                </div>
              </Link>
              <button
                onClick={() => void toggleFav(p.id, !p.favorite)}
                aria-label={p.favorite ? `Remover ${p.name} dos favoritos` : `Favoritar ${p.name}`}
                aria-pressed={p.favorite}
                className="absolute top-3 right-3 grid size-9 place-items-center rounded-lg bg-surface/90 text-muted shadow-pop hover:text-ink"
              >
                <Star size={15} className={p.favorite ? 'fill-current text-medium' : ''} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
