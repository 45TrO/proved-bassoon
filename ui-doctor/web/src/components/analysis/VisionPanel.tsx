import { clsx } from 'clsx';
import { AlertTriangle, ChevronDown, ScanEye } from 'lucide-react';
import { useState } from 'react';
import type { TraceEntry, VisionReport } from '@shared/types';
import { pluralize } from '../../lib/format';

const OUTCOME: Record<TraceEntry['outcome'], { label: string; className: string }> = {
  accepted: { label: 'Aceito', className: 'text-ok' },
  corroborated: { label: 'Confirmação', className: 'text-inspect' },
  downgraded: { label: 'Rebaixado', className: 'text-medium' },
  rejected: { label: 'Rejeitado', className: 'text-muted' },
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}

/**
 * Relatório do pipeline de visão: o que cada módulo mediu, quantas regras
 * dispararam e como o monitor decidiu cada achado (rastro auditável).
 */
export function VisionPanel({ report }: { report: VisionReport }) {
  const [open, setOpen] = useState(false);
  const { modules: m, findings: f } = report;
  return (
    <section className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 pb-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ScanEye size={15} className="text-inspect" /> Visão computacional
          </h3>
          <p className="mt-1 max-w-prose text-sm text-muted">
            OCR, processamento de imagem, reconhecimento de padrões e parsing de DOM produzem fatos; um sistema de regras decide cada achado e o confronta com as medições do DOM.
          </p>
        </div>
        <p className="tabular text-sm text-muted">
          {report.rules.fired} de {report.rules.evaluated} regras dispararam
        </p>
      </div>

      <div className="grid gap-x-8 gap-y-4 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
        <dl>
          <p className="mb-1 text-xs font-medium text-muted">OCR ({m.ocr.languages.join(' + ')})</p>
          <Stat label="Palavras lidas" value={m.ocr.words} />
          <Stat label="Confiança média" value={m.ocr.meanConfidence === null ? '—' : `${m.ocr.meanConfidence}%`} />
          <Stat label="Tempo" value={`${(m.ocr.durationMs / 1000).toFixed(1)} s`} />
        </dl>
        <dl>
          <p className="mb-1 text-xs font-medium text-muted">Processamento de imagem</p>
          <Stat label="Blocos segmentados" value={m.image.blocks} />
          <Stat label="Densidade de bordas" value={m.image.edgeDensity === null ? '—' : `${Math.round(m.image.edgeDensity * 100)}%`} />
          <Stat label="Ocupação da 1ª dobra" value={m.image.foregroundRatio === null ? '—' : `${Math.round(m.image.foregroundRatio * 100)}%`} />
        </dl>
        <dl>
          <p className="mb-1 text-xs font-medium text-muted">Padrões reconhecidos</p>
          <Stat label="Botões" value={m.patterns.buttons} />
          <Stat label="Campos" value={m.patterns.fields} />
          <Stat label="Itens de menu" value={m.patterns.navItems} />
        </dl>
        <dl>
          <p className="mb-1 text-xs font-medium text-muted">Decisões do monitor</p>
          <Stat label="Aceitos" value={f.accepted} />
          <Stat label="Confirmações do DOM" value={f.corroborated} />
          <Stat label="Rejeitados" value={f.rejected} />
        </dl>
      </div>

      {report.warnings.length > 0 && (
        <ul className="space-y-1 border-t border-line px-4 py-3">
          {report.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-xs text-muted">
              <AlertTriangle size={13} className="mt-px shrink-0 text-medium" /> {w}
            </li>
          ))}
        </ul>
      )}

      {report.trace.length > 0 && (
        <div className="border-t border-line">
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="tap flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium hover:bg-surface-2/60">
            Rastro de decisões ({pluralize(report.trace.length, 'registro', 'registros')})
            <ChevronDown size={15} className={clsx('text-faint transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <ol className="max-h-80 divide-y divide-line overflow-auto border-t border-line text-sm">
              {report.trace.map((t, i) => (
                <li key={i} className="grid gap-x-3 gap-y-0.5 px-4 py-2 sm:grid-cols-[6.5rem_14rem_1fr]">
                  <span className={clsx('text-xs font-medium', OUTCOME[t.outcome].className)}>{OUTCOME[t.outcome].label}</span>
                  <code className="truncate font-mono text-[11px] text-faint" title={t.rule}>
                    {t.rule}
                  </code>
                  <span className="text-ink-2">{t.reason}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
