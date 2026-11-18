import type { Issue, IssueCategory, Scores, Severity } from '../domain/types.js';

/**
 * Pontuação transparente:
 *  - cada categoria parte de 100;
 *  - cada problema subtrai a penalidade da sua severidade, multiplicada por um
 *    fator de recorrência com retorno decrescente: 1 + 0.35·log2(ocorrências), até 2×;
 *  - UI = 40% visual + 35% responsividade + 25% identidade;
 *  - UX = 55% experiência + 45% acessibilidade;
 *  - geral = média de UI e UX.
 */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 24,
  high: 14,
  medium: 7,
  low: 3,
};

const CATEGORIES: IssueCategory[] = ['visual', 'ux', 'accessibility', 'responsive', 'identity'];

export function recurrenceFactor(occurrences: number): number {
  return Math.min(2, 1 + 0.35 * Math.log2(Math.max(1, occurrences)));
}

export function computeScores(issues: Issue[], measured: IssueCategory[] = CATEGORIES): Scores {
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 100])) as Record<IssueCategory, number>;
  for (const i of issues) {
    if (i.status === 'dismissed') continue;
    categories[i.category] -= SEVERITY_PENALTY[i.severity] * recurrenceFactor(i.occurrences);
  }
  for (const c of CATEGORIES) categories[c] = Math.max(0, Math.round(categories[c]));
  const weighted = (parts: [IssueCategory, number][]) => {
    const avail = parts.filter(([c]) => measured.includes(c));
    if (avail.length === 0) return 0;
    const total = avail.reduce((a, [, w]) => a + w, 0);
    return Math.round(avail.reduce((a, [c, w]) => a + categories[c] * w, 0) / total);
  };
  const ui = weighted([
    ['visual', 0.4],
    ['responsive', 0.35],
    ['identity', 0.25],
  ]);
  const ux = weighted([
    ['ux', 0.55],
    ['accessibility', 0.45],
  ]);
  return { overall: Math.round((ui + ux) / 2), ui, ux, categories };
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      SEVERITY_PENALTY[b.severity] * recurrenceFactor(b.occurrences) - SEVERITY_PENALTY[a.severity] * recurrenceFactor(a.occurrences),
  );
}
