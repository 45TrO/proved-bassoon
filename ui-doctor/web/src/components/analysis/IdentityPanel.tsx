import { Check, Copy, X } from 'lucide-react';
import type { IdentityReport } from '@shared/types';
import { useToast } from '../ui/Toast';

const ROLE_LABEL = { background: 'Fundo', text: 'Texto', accent: 'Destaque', border: 'Borda' } as const;

function copy(text: string, toast: ReturnType<typeof useToast>) {
  void navigator.clipboard?.writeText(text).then(
    () => toast(`${text} copiado`),
    () => toast('Não foi possível copiar', 'error'),
  );
}

export function IdentityPanel({ identity }: { identity: IdentityReport }) {
  const toast = useToast();
  const maxShare = Math.max(...identity.palette.map((p) => p.share), 0.01);
  return (
    <div className="space-y-10">
      <section>
        <h3 className="text-[15px] font-semibold">Paleta detectada</h3>
        <p className="mt-1 text-sm text-muted">Cores ponderadas pela área que ocupam na página. Clique para copiar.</p>
        {identity.palette.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Nenhuma cor pôde ser medida.</p>
        ) : (
          <>
            <div className="mt-4 flex h-14 overflow-hidden rounded-xl border border-line" role="img" aria-label={`Proporção das cores: ${identity.palette.map((p) => `${p.hex} ${Math.round(p.share * 100)}%`).join(', ')}`}>
              {identity.palette.map((p) => (
                <span key={p.hex} style={{ flexGrow: Math.max(p.share, 0.02), background: p.hex }} />
              ))}
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {identity.palette.map((p) => (
                <li key={p.hex}>
                  <button onClick={() => copy(p.hex, toast)} className="group w-full rounded-lg border border-line bg-surface p-2 text-left hover:border-line-strong">
                    <span className="block h-12 rounded-md border border-black/5" style={{ background: p.hex }} />
                    <span className="mt-2 flex items-center justify-between font-mono text-xs">
                      {p.hex}
                      <Copy size={12} className="text-faint opacity-0 group-hover:opacity-100" />
                    </span>
                    <span className="mt-0.5 flex items-center justify-between text-xs text-muted">
                      {ROLE_LABEL[p.role]}
                      <span className="tabular">{Math.round(p.share * 100)}%</span>
                    </span>
                    <span className="mt-1.5 block h-0.5 rounded-full bg-surface-2">
                      <span className="block h-full rounded-full bg-ink-2" style={{ width: `${(p.share / maxShare) * 100}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {identity.typography.length > 0 && (
        <section>
          <h3 className="text-[15px] font-semibold">Tipografia</h3>
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {identity.typography.map((t) => (
              <li key={t.family} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-lg" style={{ fontFamily: `"${t.family}", var(--font-sans)` }}>
                    {t.family}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Pesos {t.weights.join(', ')} · tamanhos {t.sizes.map((s) => `${s}px`).join(', ')}
                  </p>
                </div>
                <span className="tabular text-sm font-medium">{Math.round(t.usage * 100)}% do texto</span>
              </li>
            ))}
          </ul>
          {identity.typeScale.length > 0 && (
            <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
              {identity.typeScale.map((s) => (
                <span key={s} className="inline-flex flex-col items-center gap-1">
                  <span className="leading-none" style={{ fontSize: Math.min(s, 48) }}>
                    Aa
                  </span>
                  <span className="tabular text-2xs text-faint">{s}px</span>
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {identity.contrastPairs.length > 0 && (
        <section>
          <h3 className="text-[15px] font-semibold">Combinações de contraste em uso</h3>
          <p className="mt-1 text-sm text-muted">Pares de texto e fundo mais frequentes, medidos pelo critério WCAG 2.2.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {identity.contrastPairs.map((p) => (
              <li key={`${p.foreground}${p.background}`} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5">
                <span className="grid size-11 shrink-0 place-items-center rounded-md border border-black/5 text-lg font-semibold" style={{ background: p.background, color: p.foreground }}>
                  Aa
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs">
                    {p.foreground} / {p.background}
                  </span>
                  {p.sample && <span className="block truncate text-xs text-muted">“{p.sample}”</span>}
                </span>
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${p.passesAA ? 'text-ok' : 'text-critical'}`}>
                  {p.passesAA ? <Check size={13} /> : <X size={13} />}
                  <span className="tabular">{p.ratio}:1</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {identity.suggestions.length > 0 && (
        <section>
          <h3 className="text-[15px] font-semibold">Paletas recomendadas</h3>
          <p className="mt-1 text-sm text-muted">Derivadas da cor de marca detectada. Cada cor indica o texto que funciona sobre ela e o contraste resultante.</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {identity.suggestions.map((s) => (
              <article key={s.name} className="rounded-xl border border-line bg-surface p-4">
                <h4 className="text-sm font-semibold">{s.name}</h4>
                <p className="mt-1 text-xs leading-relaxed text-muted">{s.rationale}</p>
                <ul className="mt-4 space-y-1.5">
                  {s.colors.map((c) => (
                    <li key={c.role + c.hex}>
                      <button onClick={() => copy(c.hex, toast)} className="flex h-10 w-full items-center justify-between rounded-md px-3 text-xs font-medium" style={{ background: c.hex, color: c.onColor }}>
                        <span>{c.role}</span>
                        <span className="font-mono">
                          {c.hex} · {c.contrast}:1
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
