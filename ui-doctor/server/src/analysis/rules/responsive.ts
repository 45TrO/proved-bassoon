import type { SnapEl } from '../../capture/snapshot.js';
import type { Evidence, Issue, ViewportName } from '../../domain/types.js';
import { evidenceFrom, issue, plural, textElements, visible, type Rule } from './helpers.js';

const SMALL_VIEWPORTS: ViewportName[] = ['tablet', 'mobile'];

/** Escolhe os "culpados" de overflow: o elemento mais externo de cada cadeia. */
export function overflowCulprits(els: SnapEl[]): SnapEl[] {
  const overflowing = els.filter((e) => e.overflowRight > 0 && !e.clippedByAncestor && e.position !== 'fixed');
  const set = new Set(overflowing.map((e) => e.i));
  const byIndex = new Map(els.map((e) => [e.i, e]));
  return overflowing
    .filter((e) => {
      // Mantém o elemento se nenhum ancestral também transborda pelo menos o mesmo tanto.
      let p = byIndex.get(e.parent);
      while (p) {
        if (set.has(p.i) && p.overflowRight >= e.overflowRight - 2) return false;
        p = byIndex.get(p.parent);
      }
      return true;
    })
    .sort((a, b) => b.overflowRight - a.overflowRight);
}

const overflowRule: Rule = {
  id: 'responsive.overflow',
  run(snapshots) {
    const issues: Issue[] = [];
    for (const vp of SMALL_VIEWPORTS) {
      const snap = snapshots[vp];
      if (!snap) continue;
      const extra = snap.docWidth - snap.clientWidth;
      if (extra <= 1) continue;
      const culprits = overflowCulprits(visible(snap));
      const evidence: Evidence[] = culprits.map((e) =>
        evidenceFrom(vp, e, { overflow: `${e.overflowRight}px`, width: `${e.w}px`, viewport: `${snap.clientWidth}px` }),
      );
      if (evidence.length === 0) {
        evidence.push({ viewport: vp, measured: { documentWidth: snap.docWidth, viewportWidth: snap.clientWidth } });
      }
      issues.push(
        issue({
          ruleId: 'responsive.overflow',
          viewport: vp,
          category: 'responsive',
          severity: vp === 'mobile' ? 'high' : 'medium',
          title: `Rolagem horizontal no ${vp === 'mobile' ? 'mobile' : 'tablet'}`,
          description: `A página tem ${snap.docWidth}px de largura em uma tela de ${snap.clientWidth}px: ${extra}px de conteúdo vazam para a direita.` +
            (culprits.length ? ` ${plural(culprits.length, 'elemento causa', 'elementos causam')} o vazamento.` : ''),
          recommendation: 'Remova larguras fixas em px dos elementos indicados, use max-width: 100% e quebra de palavras longas (overflow-wrap: anywhere).',
          evidence,
          occurrences: Math.max(culprits.length, 1),
          fixable: culprits.length > 0,
        }),
      );
    }
    return issues;
  },
};

const textCutRule: Rule = {
  id: 'responsive.text-cut',
  run(snapshots) {
    const evidence: Evidence[] = [];
    for (const vp of ['desktop', 'tablet', 'mobile'] as ViewportName[]) {
      const snap = snapshots[vp];
      if (!snap) continue;
      for (const e of visible(snap)) {
        if (e.textCut) evidence.push(evidenceFrom(vp, e, { visibleWidth: `${e.w}px`, issue: 'texto cortado sem reticências' }));
      }
    }
    if (evidence.length === 0) return [];
    return [
      issue({
        ruleId: 'responsive.text-cut',
        category: 'responsive',
        severity: 'medium',
        title: 'Texto cortado',
        description: `${plural(evidence.length, 'elemento tem', 'elementos têm')} texto escondido por overflow, sem indicação de que há mais conteúdo.`,
        recommendation: 'Permita quebra de linha ou, se o corte for intencional, use text-overflow: ellipsis e mostre o texto completo em title/tooltip.',
        evidence,
        fixable: true,
      }),
    ];
  },
};

const metaViewportRule: Rule = {
  id: 'responsive.meta-viewport',
  run(snapshots) {
    const snap = snapshots.mobile ?? snapshots.desktop;
    if (!snap || snap.metaViewport) return [];
    return [
      issue({
        ruleId: 'responsive.meta-viewport',
        category: 'responsive',
        severity: 'high',
        title: 'Meta viewport ausente',
        description: 'Sem <meta name="viewport">, navegadores móveis renderizam a página como desktop (~980 px) e a reduzem, deixando tudo minúsculo.',
        recommendation: 'Adicione <meta name="viewport" content="width=device-width, initial-scale=1"> no <head>.',
        evidence: [{ viewport: 'mobile', selector: 'head', measured: { metaViewport: 'ausente', layoutWidth: snap.clientWidth } }],
      }),
    ];
  },
};

const mobileTextRule: Rule = {
  id: 'responsive.small-text',
  run(snapshots) {
    const snap = snapshots.mobile;
    if (!snap) return [];
    const tiny = textElements(snap).filter((t) => t.fontSize < 12 && t.words >= 3);
    if (tiny.length === 0) return [];
    return [
      issue({
        ruleId: 'responsive.small-text',
        category: 'responsive',
        severity: tiny.length > 6 ? 'medium' : 'low',
        title: 'Texto ilegível no mobile',
        description: `${plural(tiny.length, 'bloco de texto fica', 'blocos de texto ficam')} abaixo de 12 px em 390 px de largura.`,
        recommendation: 'Use no mínimo 14 px para texto secundário e 16 px para texto corrido no mobile.',
        evidence: tiny.map((t) => evidenceFrom('mobile', t, { fontSize: `${t.fontSize}px` })),
        fixable: true,
      }),
    ];
  },
};

const mobileNavRule: Rule = {
  id: 'responsive.nav',
  run(snapshots) {
    const snap = snapshots.mobile;
    if (!snap || snap.landmarks.nav === 0) return [];
    if (snap.navOverflow) {
      return [
        issue({
          ruleId: 'responsive.nav',
          category: 'responsive',
          severity: 'high',
          title: 'Menu transborda no mobile',
          description: `Itens da navegação ficam fora da tela em 390 px (${snap.navLinksVisible} itens visíveis na primeira tela).`,
          recommendation: 'Colapse a navegação em um botão de menu (com aria-expanded) abaixo de ~768 px ou permita rolagem horizontal explícita.',
          evidence: [{ viewport: 'mobile', selector: 'nav', measured: { visibleItems: snap.navLinksVisible, overflow: true, toggle: snap.navToggle } }],
        }),
      ];
    }
    if (snap.navLinksVisible > 6 && !snap.navToggle) {
      return [
        issue({
          ruleId: 'responsive.nav',
          category: 'responsive',
          severity: 'medium',
          title: 'Menu não se adapta ao mobile',
          description: `${snap.navLinksVisible} itens de navegação ocupam a primeira tela do mobile e não há botão de menu.`,
          recommendation: 'Agrupe a navegação em um menu recolhível com botão acessível (aria-expanded, aria-controls).',
          evidence: [{ viewport: 'mobile', selector: 'nav', measured: { visibleItems: snap.navLinksVisible, toggle: false } }],
        }),
      ];
    }
    return [];
  },
};

/** Compara a página entre desktop e mobile para detectar layouts que não reorganizam. */
const scaledLayoutRule: Rule = {
  id: 'responsive.layout',
  run(snapshots) {
    const snap = snapshots.mobile;
    if (!snap) return [];
    const els = visible(snap);
    const narrowColumns = els.filter(
      (e) => e.kind === 'text' && e.words >= 8 && e.w < 140 && e.w > 0 && e.x + e.w <= snap.clientWidth,
    );
    if (narrowColumns.length < 3) return [];
    return [
      issue({
        ruleId: 'responsive.layout',
        category: 'responsive',
        severity: 'medium',
        title: 'Colunas estreitas demais no mobile',
        description: `${plural(narrowColumns.length, 'bloco de texto fica espremido', 'blocos de texto ficam espremidos')} em menos de 140 px de largura, sinal de que colunas do desktop não foram empilhadas.`,
        recommendation: 'Empilhe colunas em uma única coluna abaixo de ~640 px (grid-template-columns: 1fr ou flex-direction: column).',
        evidence: narrowColumns.map((e) => evidenceFrom('mobile', e, { width: `${e.w}px`, words: e.words })),
      }),
    ];
  },
};

export const responsiveRules: Rule[] = [overflowRule, textCutRule, metaViewportRule, mobileTextRule, mobileNavRule, scaledLayoutRule];
