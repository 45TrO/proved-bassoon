import type { Issue } from '../domain/types.js';
import { analyzeIdentity, emptyIdentity } from './identity.js';
import { accessibilityRules } from './rules/accessibility.js';
import type { Rule, Snapshots } from './rules/helpers.js';
import { responsiveRules } from './rules/responsive.js';
import { uxRules } from './rules/ux.js';
import { visualRules } from './rules/visual.js';
import { sortIssues } from './scoring.js';

export const ALL_RULES: Rule[] = [...visualRules, ...uxRules, ...accessibilityRules, ...responsiveRules];

export function runRules(snapshots: Snapshots) {
  const issues: Issue[] = [];
  const errors: string[] = [];
  for (const rule of ALL_RULES) {
    try {
      issues.push(...rule.run(snapshots));
    } catch (err) {
      // Uma regra com falha não derruba a análise; o erro é registrado como limitação.
      errors.push(`${rule.id}: ${(err as Error).message}`);
    }
  }
  const base = snapshots.desktop ?? snapshots.tablet ?? snapshots.mobile;
  let identity = emptyIdentity();
  if (base) {
    const r = analyzeIdentity(base);
    identity = r.report;
    issues.push(...r.issues);
  }
  // IDs únicos mesmo se uma regra emitir o mesmo id duas vezes.
  const seen = new Map<string, number>();
  for (const i of issues) {
    const n = seen.get(i.id) ?? 0;
    seen.set(i.id, n + 1);
    if (n > 0) i.id = `${i.id}#${n}`;
  }
  return { issues: sortIssues(issues), identity, errors };
}
