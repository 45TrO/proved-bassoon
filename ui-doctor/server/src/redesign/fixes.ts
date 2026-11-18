import type { Snapshot, SnapEl } from '../capture/snapshot.js';
import type { Issue, RedesignChange, ViewportName } from '../domain/types.js';
import { safeSelector } from './cssSanitizer.js';

type Snapshots = Partial<Record<ViewportName, Snapshot>>;

function findEl(snapshots: Snapshots, viewport: string, selector: string): SnapEl | undefined {
  const snap = snapshots[viewport as ViewportName];
  return snap?.elements.find((e) => e.selector === selector);
}

interface Built {
  css: string;
  changes: RedesignChange[];
}

/**
 * Gera CSS de correção determinístico a partir dos problemas detectados.
 * Só cobre correções seguras, que preservam identidade e layout:
 * contraste (mesmo matiz), alvos de toque, overflow, legibilidade,
 * proporção de imagens e texto pequeno no mobile.
 */
export function buildDeterministicFixes(issues: Issue[], snapshots: Snapshots): Built {
  const blocks: { media?: string; rule: string }[] = [];
  const changes: RedesignChange[] = [];
  const done = new Set<string>();
  const add = (key: string, rule: string, media?: string) => {
    if (done.has(key)) return false;
    done.add(key);
    blocks.push({ rule, media });
    return true;
  };

  for (const issue of issues) {
    if (issue.status === 'dismissed' || !issue.fixable) continue;
    for (const ev of issue.evidence) {
      const sel = ev.selector;
      if (!sel || !safeSelector(sel)) continue;
      switch (issue.ruleId) {
        case 'a11y.contrast': {
          const color = ev.measured.suggestedColor;
          if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) break;
          const rule = `${sel} { color: ${color} !important; }`;
          if (add(`contrast:${sel}`, rule)) {
            changes.push({
              id: `fix-${changes.length}`,
              issueId: issue.id,
              title: 'Contraste corrigido',
              detail: `Texto "${(ev.snippet ?? '').slice(0, 40)}" de ${ev.measured.foreground} para ${color} (${ev.measured.ratio}:1 → ≥ ${ev.measured.required}:1), mantendo o matiz.`,
              selector: sel,
              css: rule,
              source: 'rules',
            });
          }
          break;
        }
        case 'ux.touch-target': {
          const el = findEl(snapshots, 'mobile', sel);
          const display = el && (el.display === 'block' || el.display === 'flex') ? 'flex' : 'inline-flex';
          const rule = `${sel} { min-height: 44px !important; min-width: 44px !important; display: ${display} !important; align-items: center; justify-content: center; box-sizing: border-box; }`;
          if (add(`touch:${sel}`, rule, '(max-width: 900px)')) {
            changes.push({
              id: `fix-${changes.length}`,
              issueId: issue.id,
              title: 'Área de toque ampliada',
              detail: `"${ev.snippet ?? ev.measured.label ?? sel}" passa de ${ev.measured.size} para no mínimo 44×44 px em telas de toque.`,
              selector: sel,
              css: rule,
              source: 'rules',
            });
          }
          break;
        }
        case 'responsive.overflow': {
          const el = findEl(snapshots, ev.viewport, sel);
          const media = el?.tag === 'img' || el?.tag === 'video' ? '; height: auto !important' : '';
          const rule = `${sel} { max-width: 100% !important; box-sizing: border-box !important; overflow-wrap: anywhere${media}; }`;
          if (add(`overflow:${sel}`, rule, '(max-width: 1024px)')) {
            changes.push({
              id: `fix-${changes.length}`,
              issueId: issue.id,
              title: 'Vazamento horizontal contido',
              detail: `Elemento com ${ev.measured.width} de largura passa a respeitar a largura da tela (vazava ${ev.measured.overflow}).`,
              selector: sel,
              css: rule,
              source: 'rules',
            });
          }
          break;
        }
        case 'responsive.small-text': {
          const rule = `${sel} { font-size: 14px !important; }`;
          if (add(`small:${sel}`, rule, '(max-width: 640px)')) {
            changes.push({
              id: `fix-${changes.length}`,
              issueId: issue.id,
              title: 'Texto legível no mobile',
              detail: `Fonte de ${ev.measured.fontSize} para 14 px em telas pequenas.`,
              selector: sel,
              css: rule,
              source: 'rules',
            });
          }
          break;
        }
        case 'ux.line-length': {
          const rule = `${sel} { max-width: 70ch !important; }`;
          if (add(`measure:${sel}`, rule)) {
            changes.push({
              id: `fix-${changes.length}`,
              issueId: issue.id,
              title: 'Largura de leitura limitada',
              detail: `Parágrafo com ~${ev.measured.approxCharsPerLine} caracteres por linha limitado a 70ch.`,
              selector: sel,
              css: rule,
              source: 'rules',
            });
          }
          break;
        }
        case 'ux.line-height': {
          const rule = `${sel} { line-height: 1.55 !important; }`;
          if (add(`lh:${sel}`, rule)) {
            changes.push({
              id: `fix-${changes.length}`,
              issueId: issue.id,
              title: 'Entrelinha confortável',
              detail: `Altura de linha de ${ev.measured.ratio}× para 1.55×.`,
              selector: sel,
              css: rule,
              source: 'rules',
            });
          }
          break;
        }
        case 'visual.img-distorted': {
          const rule = `${sel} { object-fit: cover !important; }`;
          if (add(`fit:${sel}`, rule)) {
            changes.push({
              id: `fix-${changes.length}`,
              issueId: issue.id,
              title: 'Proporção de imagem preservada',
              detail: `Imagem distorcida em ${ev.measured.distortion} recortada com object-fit: cover.`,
              selector: sel,
              css: rule,
              source: 'rules',
            });
          }
          break;
        }
        case 'responsive.text-cut': {
          const rule = `${sel} { text-overflow: ellipsis !important; white-space: nowrap; }`;
          if (add(`cut:${sel}`, rule)) {
            changes.push({
              id: `fix-${changes.length}`,
              issueId: issue.id,
              title: 'Corte de texto sinalizado',
              detail: 'Texto cortado passa a exibir reticências, indicando que há mais conteúdo.',
              selector: sel,
              css: rule,
              source: 'rules',
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // Foco visível para navegação por teclado: melhoria universal e segura.
  blocks.push({ rule: ':where(a, button, input, select, textarea, [tabindex]):focus-visible { outline: 2px solid #2563eb !important; outline-offset: 2px !important; }' });

  const plain = blocks.filter((b) => !b.media).map((b) => b.rule);
  const byMedia = new Map<string, string[]>();
  for (const b of blocks.filter((x) => x.media)) byMedia.set(b.media!, [...(byMedia.get(b.media!) ?? []), b.rule]);
  const css = [
    '/* UI Doctor — correções automáticas */',
    ...plain,
    ...[...byMedia.entries()].map(([m, rules]) => `@media ${m} {\n  ${rules.join('\n  ')}\n}`),
  ].join('\n');
  return { css, changes };
}
