import { clsx } from 'clsx';
import { ArrowRight, Check, ChevronDown, ClipboardCopy, Columns2, SplitSquareHorizontal, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AnalysisDetail, Capture, RedesignChange, RedesignMode, RedesignSummary } from '@shared/types';
import { api, ApiError, fileUrl } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { Button } from '../ui/Button';
import { ErrorNotice } from '../ui/Empty';
import { Spinner } from '../ui/Spinner';
import { Tabs } from '../ui/Tabs';
import { useToast } from '../ui/Toast';

/** Agrupa alterações do mesmo tipo, preservando a ordem de primeira ocorrência. */
export function groupChanges(changes: RedesignChange[]): [string, RedesignChange[]][] {
  const map = new Map<string, RedesignChange[]>();
  for (const c of changes) map.set(c.title, [...(map.get(c.title) ?? []), c]);
  return [...map.entries()];
}

/** Comparação por cortina: as duas imagens empilhadas, a de cima recortada pela posição do controle. */
export function CompareSlider({ before, after, label }: { before: string; after: string; label: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface-2">
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="relative">
          <img src={after} alt={`${label} depois das melhorias`} className="block w-full select-none" draggable={false} />
          <img
            src={before}
            alt={`${label} antes das melhorias`}
            className="absolute inset-0 block w-full select-none"
            style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
            draggable={false}
          />
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-inspect" style={{ left: `calc(${pos}% - 1px)` }} />
        </div>
      </div>
      <span className="pointer-events-none absolute top-3 left-3 rounded-md bg-ink/80 px-2 py-1 text-xs font-medium text-paper">Antes</span>
      <span className="pointer-events-none absolute top-3 right-3 rounded-md bg-inspect px-2 py-1 text-xs font-medium text-white">Depois</span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Posição da comparação entre antes e depois"
        className="absolute inset-x-0 bottom-3 mx-auto block w-[calc(100%-2rem)] accent-[var(--inspect)]"
      />
    </div>
  );
}

function Delta({ label, before, after, lowerIsBetter = false }: { label: string; before: number; after: number; lowerIsBetter?: boolean }) {
  const diff = after - before;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <div className="bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="tabular mt-1 flex items-center gap-2 text-lg font-semibold">
        <span className="text-muted">{before}</span>
        <ArrowRight size={14} className="text-faint" />
        <span>{after}</span>
        {diff !== 0 && (
          <span className={clsx('text-xs font-medium', good ? 'text-ok' : 'text-critical')}>
            {diff > 0 ? '+' : ''}
            {diff}
          </span>
        )}
      </p>
    </div>
  );
}

function RedesignResult({ analysisId, redesign }: { analysisId: string; redesign: RedesignSummary }) {
  const toast = useToast();
  const viewports = redesign.after.map((c) => c.viewport).filter((v) => v !== 'tablet') as Capture['viewport'][];
  const [viewport, setViewport] = useState<Capture['viewport']>(viewports[0] ?? 'desktop');
  const [layout, setLayout] = useState<'slider' | 'side'>('slider');
  const [showCss, setShowCss] = useState(false);
  const before = redesign.before.find((c) => c.viewport === viewport);
  const after = redesign.after.find((c) => c.viewport === viewport);

  return (
    <div className="space-y-6">
      {redesign.scoresBefore && redesign.scoresAfter && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
          <Delta label="Nota geral" before={redesign.scoresBefore.overall} after={redesign.scoresAfter.overall} />
          <Delta label="UI" before={redesign.scoresBefore.ui} after={redesign.scoresAfter.ui} />
          <Delta label="UX" before={redesign.scoresBefore.ux} after={redesign.scoresAfter.ux} />
          <Delta label="Problemas medidos" before={redesign.issuesBefore ?? 0} after={redesign.issuesAfter ?? 0} lowerIsBetter />
        </div>
      )}
      <p className="text-xs text-muted">
        O "depois" é a página real recapturada com o CSS proposto aplicado; as regras foram executadas de novo sobre ela. A comparação considera apenas os problemas detectados pelas regras.
      </p>
      {redesign.note && <p className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-2">{redesign.note}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Resolução"
          size="sm"
          value={viewport}
          onChange={setViewport}
          items={viewports.map((v) => ({ key: v, label: v === 'desktop' ? 'Desktop' : 'Mobile' }))}
        />
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-0.5" role="radiogroup" aria-label="Modo de comparação">
          {(
            [
              ['slider', 'Cortina', SplitSquareHorizontal],
              ['side', 'Lado a lado', Columns2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              role="radio"
              aria-checked={layout === key}
              onClick={() => setLayout(key)}
              className={clsx('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium', layout === key ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink')}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      {before && after ? (
        layout === 'slider' ? (
          <div className={clsx(viewport === 'mobile' && 'mx-auto max-w-[420px]')}>
            <CompareSlider before={fileUrl(analysisId, before.file)} after={fileUrl(analysisId, after.file)} label={viewport === 'mobile' ? 'Mobile' : 'Desktop'} />
          </div>
        ) : (
          <div className={clsx('grid gap-4', viewport === 'mobile' ? 'mx-auto max-w-[860px] grid-cols-2' : 'md:grid-cols-2')}>
            {[
              ['Antes', before],
              ['Depois', after],
            ].map(([label, cap]) => (
              <figure key={label as string} className="min-w-0">
                <figcaption className="mb-2 text-xs font-medium text-muted">{label as string}</figcaption>
                <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface-2">
                  <img src={fileUrl(analysisId, (cap as Capture).file)} alt={`${label as string}: captura em ${(cap as Capture).width}px`} className="block w-full" />
                </div>
              </figure>
            ))}
          </div>
        )
      ) : (
        <p className="text-sm text-muted">Captura indisponível para esta resolução.</p>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold">Alterações aplicadas ({redesign.changes.length})</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowCss((v) => !v)} aria-expanded={showCss}>
              {showCss ? 'Ocultar CSS' : 'Ver CSS'}
            </Button>
            <Button
              size="sm"
              icon={<ClipboardCopy size={14} />}
              onClick={() =>
                void navigator.clipboard?.writeText(redesign.css).then(
                  () => toast('CSS copiado'),
                  () => toast('Não foi possível copiar', 'error'),
                )
              }
            >
              Copiar CSS
            </Button>
          </div>
        </div>
        {showCss && <pre className="mb-4 max-h-80 overflow-auto rounded-xl border border-line bg-surface p-4 font-mono text-xs leading-relaxed text-ink-2">{redesign.css}</pre>}
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {groupChanges(redesign.changes).map(([title, items], gi) => (
            <details key={title} open={gi === 0} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
                <span className="text-faint"><Wand2 size={15} /></span>
                <span className="flex-1 text-sm font-medium">{title}</span>
                <span className="tabular rounded bg-surface-2 px-1.5 text-xs text-muted">{items.length}</span>
                <ChevronDown size={15} className="text-faint transition-transform group-open:rotate-180" />
              </summary>
              <ul className="border-t border-line bg-surface-2/30">
                {items.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 pl-11">
                    <span className="block text-sm text-ink-2">{c.detail}</span>
                    <code className="mt-0.5 block truncate font-mono text-[11px] text-faint" title={c.selector}>
                      {c.selector}
                    </code>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

export function BeforeAfter({ analysis, onCreated }: { analysis: AnalysisDetail; onCreated: () => void }) {
  const latest = analysis.redesigns[0] ?? null;
  const [mode, setMode] = useState<RedesignMode>('preserve');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useAsync(() => (latest ? api.redesign(latest.id) : Promise.resolve(null)), [latest?.id], {
    interval: 1500,
    shouldPoll: (r) => r !== null && (r.status === 'queued' || r.status === 'running'),
  });
  const redesign = live.data ?? latest;
  const running = redesign && (redesign.status === 'queued' || redesign.status === 'running');

  useEffect(() => setError(null), [mode]);

  if (analysis.sourceType === 'image') {
    return (
      <div className="rounded-xl border border-line bg-surface p-6">
        <h3 className="text-[15px] font-semibold">Proposta visual indisponível para imagens</h3>
        <p className="mt-1 max-w-prose text-sm text-muted">
          O antes e depois aplica as correções na página real e mede o resultado de novo. Para isso é preciso um endereço acessível. Analise a página pela URL para gerar a proposta.
        </p>
      </div>
    );
  }

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await api.createRedesign(analysis.id, mode);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar a proposta.');
    } finally {
      setStarting(false);
    }
  }

  const fixable = analysis.result?.issues.filter((i) => i.fixable && (i.status ?? 'open') !== 'dismissed').length ?? 0;

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h3 className="text-[15px] font-semibold">Gerar proposta de melhoria</h3>
            <p className="mt-1 max-w-prose text-sm text-muted">
              {fixable === 1 ? '1 problema tem correção automática.' : `${fixable} problemas têm correção automática.`} A proposta é aplicada sobre a página real, recapturada e medida de novo.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de proposta">
              {(
                [
                  ['preserve', 'Preservar identidade', 'Corrige contraste, toque, overflow e legibilidade mantendo cores, fontes e estrutura.', false],
                  ['full', 'Harmonização completa', 'Além das correções, unifica variantes de componentes, cores quase iguais e famílias tipográficas excedentes.', false],
                ] as const
              ).map(([key, title, desc, disabled]) => (
                <button
                  key={key}
                  role="radio"
                  aria-checked={mode === key}
                  aria-disabled={disabled}
                  disabled={disabled}
                  onClick={() => setMode(key)}
                  className={clsx(
                    'rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    mode === key ? 'border-inspect bg-inspect-soft' : 'border-line hover:border-line-strong',
                  )}
                >
                  <span className="flex items-center justify-between text-sm font-medium">
                    {title}
                    {mode === key && <Check size={14} className="text-inspect" />}
                  </span>
                  <span className="mt-1 block text-xs text-muted">{desc}</span>
                </button>
              ))}
            </div>
          </div>
          <Button variant="primary" size="lg" loading={starting} disabled={Boolean(running)} onClick={() => void start()} icon={<Wand2 size={16} />}>
            {latest ? 'Gerar nova proposta' : 'Gerar proposta'}
          </Button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-critical">{error}</p>}
      </div>

      {live.error && <ErrorNotice error={live.error} onRetry={live.reload} />}
      {running && (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-5 py-4 text-sm" aria-live="polite">
          <Spinner className="text-inspect" />
          Aplicando correções e recapturando a página em três resoluções…
        </div>
      )}
      {redesign?.status === 'failed' && <ErrorNotice error={new Error(redesign.error ?? 'Falha ao gerar a proposta.')} />}
      {redesign?.status === 'done' && (
        <div>
          <p className="mb-4 text-xs text-muted">
            Proposta {redesign.mode === 'full' ? 'de harmonização completa' : 'preservando a identidade'} gerada {relativeTime(redesign.createdAt)}.
          </p>
          <RedesignResult analysisId={analysis.id} redesign={redesign} />
        </div>
      )}
    </div>
  );
}
