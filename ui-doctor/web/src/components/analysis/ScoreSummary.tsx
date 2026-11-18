import { CATEGORY_LABELS, type IssueCategory, type Scores } from '@shared/types';
import { scoreTone, toneColor } from '../../lib/format';
import { ScoreRing } from '../ui/ScoreRing';

const ORDER: IssueCategory[] = ['visual', 'responsive', 'identity', 'ux', 'accessibility'];

export function ScoreSummary({ scores, scored }: { scores: Scores; scored: boolean }) {
  if (!scored) {
    return (
      <div className="rounded-xl border border-line bg-surface p-5">
        <p className="text-sm font-medium">Sem pontuação</p>
        <p className="mt-1 text-sm text-muted">Não há medições suficientes para atribuir uma nota. Veja as limitações abaixo.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-[auto_1fr]">
      <div className="flex items-center gap-5 bg-surface p-5">
        <ScoreRing value={scores.overall} size={104} stroke={7} label="Nota geral" />
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted">Nota geral</p>
            <p className="text-sm font-medium">{{ good: 'Interface saudável', fair: 'Precisa de ajustes', poor: 'Problemas sérios', none: '' }[scoreTone(scores.overall)]}</p>
          </div>
          <div className="flex gap-4">
            {(['ui', 'ux'] as const).map((k) => (
              <div key={k} className="flex items-center gap-2">
                <ScoreRing value={scores[k]} size={40} stroke={3.5} label={k.toUpperCase()} />
                <span className="text-xs font-medium text-muted">{k.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="bg-surface p-5">
        <ul className="space-y-2.5">
          {ORDER.map((c) => {
            const v = scores.categories[c];
            return (
              <li key={c} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-3 text-sm">
                <span className="text-muted">{CATEGORY_LABELS[c]}</span>
                <span className="h-1.5 rounded-full bg-surface-2" role="img" aria-label={`${CATEGORY_LABELS[c]}: ${v} de 100`}>
                  <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${v}%`, background: toneColor[scoreTone(v)] }} />
                </span>
                <span className="tabular text-right font-medium">{v}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-faint">UI = visual, responsividade e identidade. UX = experiência e acessibilidade. Cada problema desconta pela severidade e recorrência.</p>
      </div>
    </div>
  );
}
