import { ExternalLink, Info, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { AnalysisDetail, Capture, Issue, IssueStatus } from '@shared/types';
import { BeforeAfter } from '../components/analysis/BeforeAfter';
import { IdentityPanel } from '../components/analysis/IdentityPanel';
import { Inspector } from '../components/analysis/Inspector';
import { IssueList } from '../components/analysis/IssueList';
import { ProgressView } from '../components/analysis/ProgressView';
import { ResponsivePanel } from '../components/analysis/ResponsivePanel';
import { ScoreSummary } from '../components/analysis/ScoreSummary';
import { VisionPanel } from '../components/analysis/VisionPanel';
import { Button } from '../components/ui/Button';
import { ConfirmButton } from '../components/ui/ConfirmButton';
import { EmptyState, ErrorNotice, Skeleton } from '../components/ui/Empty';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';
import { api, ApiError } from '../lib/api';
import { pluralize, hostOf, relativeTime } from '../lib/format';
import { useAsync, useDocumentTitle } from '../lib/hooks';

type Tab = 'diagnostico' | 'identidade' | 'responsividade' | 'antes-depois';
const VIEWPORT_LABEL: Record<Capture['viewport'], string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile', image: 'Imagem' };
const RUNNING = new Set(['queued', 'capturing', 'analyzing', 'scoring']);

function Header({ a, onFavorite, onRerun, onDelete, rerunning }: { a: AnalysisDetail; onFavorite: () => void; onRerun: () => void; onDelete: () => void; rerunning: boolean }) {
  const title = a.result?.page.title || (a.sourceType === 'url' ? hostOf(a.target) : a.projectName);
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="min-w-0">
        <p className="mb-1 text-xs text-muted">
          <Link to={`/projetos/${a.projectId}`} className="hover:text-ink">
            {a.projectName}
          </Link>
          <span className="mx-1.5 text-faint">/</span>
          {relativeTime(a.createdAt)}
        </p>
        <h1 className="line-clamp-2 text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {a.sourceType === 'url' && (
          <a href={a.target} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex max-w-full items-center gap-1 text-sm text-muted hover:text-ink">
            <span className="truncate">{a.target}</span>
            <ExternalLink size={13} className="shrink-0" />
          </a>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={onFavorite} aria-pressed={a.favorite} icon={<Star size={14} className={a.favorite ? 'fill-current text-medium' : ''} />}>
          {a.favorite ? 'Favorito' : 'Favoritar'}
        </Button>
        {a.sourceType === 'url' && (
          <Button size="sm" onClick={onRerun} loading={rerunning} icon={<RefreshCw size={14} />}>
            Analisar de novo
          </Button>
        )}
        <ConfirmButton size="sm" variant="ghost" icon={<Trash2 size={14} />} onConfirm={onDelete}>
          Excluir
        </ConfirmButton>
      </div>
    </div>
  );
}

function Diagnosis({ a, onStatus }: { a: AnalysisDetail; onStatus: (issue: Issue, s: IssueStatus) => Promise<void> }) {
  const result = a.result!;
  const [params, setParams] = useSearchParams();
  const [viewport, setViewport] = useState<Capture['viewport']>(result.captures[0]?.viewport ?? 'desktop');
  const selectedId = params.get('problema');
  const setSelected = (id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set('problema', id);
        else n.delete('problema');
        return n;
      },
      { replace: true },
    );

  // Ao escolher um problema sem evidência na resolução atual, muda para a primeira que tiver.
  useEffect(() => {
    const issue = result.issues.find((i) => i.id === selectedId);
    if (!issue) return;
    const vps = issue.evidence.filter((e) => e.rect).map((e) => e.viewport);
    if (vps.length && !vps.includes(viewport)) setViewport(vps[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const capture = result.captures.find((c) => c.viewport === viewport) ?? result.captures[0];
  const openIssues = useMemo(() => result.issues.filter((i) => (i.status ?? 'open') === 'open' || i.id === selectedId), [result.issues, selectedId]);

  return (
    <div className="space-y-8">
      <ScoreSummary scores={result.scores} scored={result.scored} unmeasured={result.unmeasured ?? []} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 xl:sticky xl:top-4">
          {result.captures.length > 1 && (
            <div className="mb-3">
              <Tabs
                label="Resolução da captura"
                size="sm"
                value={viewport}
                onChange={setViewport}
                items={result.captures.map((c) => ({
                  key: c.viewport,
                  label: `${VIEWPORT_LABEL[c.viewport]} · ${c.width}`,
                  count: openIssues.filter((i) => i.evidence.some((e) => e.viewport === c.viewport && e.rect)).length,
                }))}
              />
            </div>
          )}
          {capture && <Inspector analysisId={a.id} capture={capture} issues={openIssues} selectedId={selectedId} onSelect={setSelected} />}
        </div>
        <div className="min-w-0">
          <IssueList issues={result.issues} selectedId={selectedId} onSelect={setSelected} onStatus={onStatus} />
        </div>
      </div>
      <Notes a={a} />
    </div>
  );
}

function Notes({ a }: { a: AnalysisDetail }) {
  const r = a.result!;
  return (
    <section className="space-y-4">
      <VisionPanel report={r.vision} />
      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Info size={14} className="text-faint" /> Cobertura da análise
        </h3>
        <p className="tabular mt-1.5 text-sm text-muted">
          {a.sourceType === 'image'
            ? `${pluralize(r.vision.modules.ocr.words, 'palavra lida', 'palavras lidas')}, ${pluralize(r.vision.modules.image.blocks, 'bloco segmentado', 'blocos segmentados')}, ${pluralize(r.vision.modules.patterns.buttons, 'botão reconhecido', 'botões reconhecidos')}, em ${(r.metrics.durationMs / 1000).toFixed(1)} s.`
            : `${r.metrics.elementsAnalyzed.toLocaleString('pt-BR')} elementos medidos, ${r.metrics.interactiveElements} interativos, ${pluralize(r.metrics.forms, 'formulário', 'formulários')}, em ${(r.metrics.durationMs / 1000).toFixed(1)} s.`}
        </p>
        {r.limitations.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
            {r.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function AnalysisPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [rerunning, setRerunning] = useState(false);
  const q = useAsync(() => api.analysis(id), [id], { interval: 1200, shouldPoll: (a) => RUNNING.has(a.status) });
  const a = q.data;
  useDocumentTitle(a ? (a.sourceType === 'url' ? hostOf(a.target) : a.projectName) : 'Análise');

  const tab = (params.get('aba') as Tab | null) ?? 'diagnostico';
  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('aba', t);
        n.delete('problema');
        return n;
      },
      { replace: true },
    );

  if (q.loading && !a) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-36" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (q.error && !a) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {notFound ? (
          <EmptyState title="Análise não encontrada" action={<Link to="/" className="tap text-sm font-medium text-inspect hover:underline">Fazer uma nova análise</Link>}>
            Ela pode ter sido excluída.
          </EmptyState>
        ) : (
          <ErrorNotice error={q.error} onRetry={q.reload} />
        )}
      </div>
    );
  }
  if (!a) return null;

  const rerun = async () => {
    setRerunning(true);
    try {
      const r = await api.analyzeUrl(a.target);
      navigate(`/analises/${r.id}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setRerunning(false);
    }
  };

  const toggleFavorite = async () => {
    try {
      await api.updateProject(a.projectId, { favorite: !a.favorite });
      q.setData((prev) => (prev ? { ...prev, favorite: !prev.favorite } : prev));
      toast(a.favorite ? 'Removido dos favoritos' : 'Adicionado aos favoritos');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = async () => {
    try {
      await api.deleteAnalysis(a.id);
      toast('Análise excluída');
      navigate('/');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const setStatus = async (issue: Issue, status: IssueStatus) => {
    try {
      await api.setIssueStatus(a.id, issue.id, status);
      q.setData((prev) =>
        prev?.result ? { ...prev, result: { ...prev.result, issues: prev.result.issues.map((i) => (i.id === issue.id ? { ...i, status } : i)) } } : prev,
      );
      toast({ implemented: 'Marcado como corrigido', dismissed: 'Problema descartado', open: 'Problema reaberto' }[status]);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const header = <Header a={a} onFavorite={() => void toggleFavorite()} onRerun={() => void rerun()} onDelete={() => void remove()} rerunning={rerunning} />;

  if (RUNNING.has(a.status) || a.status === 'failed') {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        {header}
        {a.status === 'failed' && (
          <div className="mb-6">
            <ErrorNotice error={new Error(a.error ?? 'A análise falhou.')} onRetry={a.sourceType === 'url' ? () => void rerun() : undefined} />
          </div>
        )}
        <ProgressView steps={a.progress} target={a.target} />
      </div>
    );
  }

  const result = a.result!;
  const openCount = result.issues.filter((i) => (i.status ?? 'open') === 'open').length;
  const tabs = [
    { key: 'diagnostico' as const, label: 'Diagnóstico', count: openCount },
    { key: 'identidade' as const, label: 'Identidade visual' },
    ...(a.sourceType === 'url' ? [{ key: 'responsividade' as const, label: 'Responsividade' }] : []),
    { key: 'antes-depois' as const, label: 'Antes e depois' },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      {header}
      <div className="mb-6 border-b border-line">
        <Tabs label="Seções do relatório" items={tabs} value={tabs.some((t) => t.key === tab) ? tab : 'diagnostico'} onChange={setTab} />
      </div>
      <div key={tab} className="animate-rise">
        {tab === 'diagnostico' && <Diagnosis a={a} onStatus={setStatus} />}
        {tab === 'identidade' && <IdentityPanel identity={result.identity} />}
        {tab === 'responsividade' && (
          <ResponsivePanel
            analysisId={a.id}
            captures={result.captures}
            issues={result.issues}
            onInspect={(_vp, issueId) => setParams({ aba: 'diagnostico', problema: issueId }, { replace: true })}
          />
        )}
        {tab === 'antes-depois' && <BeforeAfter analysis={a} onCreated={q.reload} />}
      </div>
    </div>
  );
}
