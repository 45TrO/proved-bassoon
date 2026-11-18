import type { Snapshot, SnapEl } from '../../capture/snapshot.js';
import type { Evidence, Issue, IssueCategory, Severity, ViewportName } from '../../domain/types.js';

export type Snapshots = Partial<Record<ViewportName, Snapshot>>;

export interface Rule {
  id: string;
  run(snapshots: Snapshots): Issue[];
}

export const MAX_EVIDENCE = 12;

export function evidenceFrom(
  viewport: ViewportName,
  el: Pick<SnapEl, 'selector' | 'x' | 'y' | 'w' | 'h' | 'text'>,
  measured: Evidence['measured'],
): Evidence {
  return {
    viewport,
    selector: el.selector,
    rect: { x: el.x, y: el.y, width: el.w, height: el.h },
    snippet: el.text ? el.text.slice(0, 90) : undefined,
    measured,
  };
}

export interface IssueInput {
  ruleId: string;
  category: IssueCategory;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  evidence: Evidence[];
  occurrences?: number;
  fixable?: boolean;
  viewport?: ViewportName;
}

export function issue(input: IssueInput): Issue {
  const suffix = input.viewport ? `:${input.viewport}` : '';
  return {
    id: `${input.ruleId}${suffix}`,
    ruleId: input.ruleId,
    source: 'rules',
    category: input.category,
    severity: input.severity,
    title: input.title,
    description: input.description,
    recommendation: input.recommendation,
    evidence: input.evidence.slice(0, MAX_EVIDENCE),
    occurrences: input.occurrences ?? input.evidence.length,
    fixable: input.fixable ?? false,
  };
}

/** Elementos visíveis ao usuário (exclui conteúdo "sr-only"). */
export function visible(snapshot: Snapshot): SnapEl[] {
  return snapshot.elements.filter((e) => !e.hidden);
}

export function textElements(snapshot: Snapshot): SnapEl[] {
  return visible(snapshot).filter((e) => e.ownText && e.words > 0 && e.fontSize > 0);
}

/** Iterar viewports na ordem desktop → tablet → mobile, apenas os capturados. */
export function eachViewport(snapshots: Snapshots): [ViewportName, Snapshot][] {
  const order: ViewportName[] = ['desktop', 'tablet', 'mobile'];
  return order.filter((v) => snapshots[v]).map((v) => [v, snapshots[v]!]);
}

export function primary(snapshots: Snapshots): [ViewportName, Snapshot] | null {
  return eachViewport(snapshots)[0] ?? null;
}

export function px(n: number): string {
  return `${Math.round(n)}px`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Remove evidências duplicadas pelo seletor, mantendo a primeira. */
export function uniqueBySelector<T extends { selector?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    if (!i.selector) return true;
    if (seen.has(i.selector)) return false;
    seen.add(i.selector);
    return true;
  });
}

export function mode(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export function isInline(el: SnapEl): boolean {
  return el.display === 'inline' || el.display === 'contents';
}
