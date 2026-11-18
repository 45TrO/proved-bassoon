import type { SnapEl } from '../../capture/snapshot.js';
import type { Evidence, Issue } from '../../domain/types.js';
import { blend, contrastRatio, fixContrast, isLargeText, parseColor, round2, toHex } from '../color.js';
import { eachViewport, evidenceFrom, issue, plural, primary, uniqueBySelector, visible, type Rule, type Snapshots } from './helpers.js';

/** Calcula o contraste efetivo de um elemento de texto. Null quando não mensurável. */
export function elementContrast(el: SnapEl): {
  ratio: number;
  required: number;
  fg: string;
  bg: string;
  suggested: string | null;
  suggestedBackground: string | null;
} | null {
  if (el.bgImage) return null;
  const bg = parseColor(el.bg);
  const fgRaw = parseColor(el.color);
  if (!bg || !fgRaw || fgRaw.a === 0) return null;
  const opaqueBg = { ...bg, a: 1 };
  const fg = fgRaw.a < 1 ? blend(fgRaw, opaqueBg) : fgRaw;
  const ratio = contrastRatio(fg, opaqueBg);
  const required = isLargeText(el.fontSize, el.fontWeight) ? 3 : 4.5;
  // Em elementos com fundo próprio (botões, selos), preservar a cor do texto e ajustar o
  // fundo mantém a identidade: botão laranja com texto branco continua assim, só mais escuro.
  const own = parseColor(el.ownBg);
  const paintsOwnBg = Boolean(own && own.a >= 0.9) && (el.kind === 'button' || el.kind === 'link' || el.padding.some((p) => p >= 4));
  let suggested: string | null = null;
  let suggestedBackground: string | null = null;
  if (ratio < required) {
    const bgFix = paintsOwnBg ? fixContrast(opaqueBg, fg, required + 0.1) : null;
    if (bgFix) suggestedBackground = toHex(bgFix);
    else {
      const fgFix = fixContrast(fg, opaqueBg, required + 0.1);
      suggested = fgFix ? toHex(fgFix) : null;
    }
  }
  return { ratio: round2(ratio), required, fg: toHex(fg), bg: toHex(opaqueBg), suggested, suggestedBackground };
}

const contrastRule: Rule = {
  id: 'a11y.contrast',
  run(snapshots: Snapshots): Issue[] {
    const evidence: (Evidence & { ratio: number })[] = [];
    for (const [vp, snap] of eachViewport(snapshots)) {
      if (vp === 'tablet') continue;
      for (const el of visible(snap)) {
        if (!el.ownText || el.words === 0 || el.fontSize === 0) continue;
        const c = elementContrast(el);
        if (!c || c.ratio >= c.required) continue;
        evidence.push({
          ...evidenceFrom(vp, el, {
            ratio: c.ratio,
            required: c.required,
            foreground: c.fg,
            background: c.bg,
            fontSize: el.fontSize,
            ...(c.suggested ? { suggestedColor: c.suggested } : {}),
            ...(c.suggestedBackground ? { suggestedBackground: c.suggestedBackground } : {}),
          }),
          ratio: c.ratio,
        });
      }
    }
    const unique = uniqueBySelector(evidence).sort((a, b) => a.ratio - b.ratio);
    if (unique.length === 0) return [];
    const worst = unique[0]!.ratio;
    const severity = worst < 2 ? 'critical' : worst < 3 ? 'high' : 'medium';
    return [
      issue({
        ruleId: 'a11y.contrast',
        category: 'accessibility',
        severity,
        title: 'Texto com contraste insuficiente',
        description: `${plural(unique.length, 'elemento de texto não atinge', 'elementos de texto não atingem')} o contraste mínimo WCAG 2.2 AA. O pior caso mede ${worst}:1.`,
        recommendation:
          'Ajuste a luminosidade (mantendo o matiz da marca) até 4.5:1 para texto normal e 3:1 para texto grande. Em botões e selos, escureça ou clareie o fundo e preserve a cor do texto. As cores sugeridas em cada evidência já atingem o mínimo.',
        evidence: unique.map(({ ratio: _r, ...e }) => e),
        occurrences: unique.length,
        fixable: true,
      }),
    ];
  },
};

const imgAltRule: Rule = {
  id: 'a11y.img-alt',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const missing = visible(snap).filter((e) => e.tag === 'img' && e.imgAlt === null && e.w * e.h >= 24 * 24);
    if (missing.length === 0) return [];
    return [
      issue({
        ruleId: 'a11y.img-alt',
        category: 'accessibility',
        severity: missing.length > 3 ? 'high' : 'medium',
        title: 'Imagens sem texto alternativo',
        description: `${plural(missing.length, 'imagem não possui', 'imagens não possuem')} o atributo alt. Leitores de tela anunciam o nome do arquivo ou ignoram o conteúdo.`,
        recommendation: 'Adicione alt descritivo em imagens informativas e alt="" em imagens puramente decorativas.',
        evidence: missing.map((e) => evidenceFrom(vp, e, { renderedSize: `${e.w}×${e.h}` })),
        occurrences: missing.length,
      }),
    ];
  },
};

const unnamedControlRule: Rule = {
  id: 'a11y.unnamed-control',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const bad = visible(snap).filter((e) => (e.kind === 'button' || e.kind === 'link') && e.name.trim() === '');
    if (bad.length === 0) return [];
    return [
      issue({
        ruleId: 'a11y.unnamed-control',
        category: 'accessibility',
        severity: 'high',
        title: 'Botões e links sem nome acessível',
        description: `${plural(bad.length, 'controle interativo não tem', 'controles interativos não têm')} texto, aria-label ou alt. Usuários de leitor de tela ouvem apenas "botão" ou "link".`,
        recommendation: 'Inclua texto visível ou aria-label descritivo (ex.: "Abrir menu", "Fechar", "Buscar") em controles que usam apenas ícones.',
        evidence: bad.map((e) => evidenceFrom(vp, e, { kind: e.kind, size: `${e.w}×${e.h}` })),
      }),
    ];
  },
};

const formLabelRule: Rule = {
  id: 'a11y.form-label',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const fields = visible(snap).filter(
      (e) => (e.kind === 'input' || e.kind === 'select' || e.kind === 'textarea') && !e.hasLabel && !['hidden', 'submit', 'button', 'reset', 'image'].includes(e.inputType ?? ''),
    );
    if (fields.length === 0) return [];
    const placeholderOnly = fields.filter((f) => f.placeholder).length;
    return [
      issue({
        ruleId: 'a11y.form-label',
        category: 'accessibility',
        severity: 'high',
        title: 'Campos de formulário sem rótulo',
        description:
          `${plural(fields.length, 'campo não possui', 'campos não possuem')} <label> associado nem aria-label.` +
          (placeholderOnly ? ` ${placeholderOnly} dependem apenas do placeholder, que desaparece ao digitar.` : ''),
        recommendation: 'Associe um <label for> visível a cada campo. Use o placeholder apenas como exemplo de formato, nunca como rótulo.',
        evidence: fields.map((e) => evidenceFrom(vp, e, { type: e.inputType ?? e.tag, placeholder: e.placeholder ?? '—' })),
      }),
    ];
  },
};

const docRule: Rule = {
  id: 'a11y.document',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const issues: Issue[] = [];
    if (!snap.lang || !snap.lang.trim()) {
      issues.push(
        issue({
          ruleId: 'a11y.lang',
          category: 'accessibility',
          severity: 'medium',
          title: 'Idioma da página não declarado',
          description: 'O elemento <html> não possui o atributo lang. Leitores de tela podem pronunciar o conteúdo com o idioma errado.',
          recommendation: 'Declare o idioma principal, por exemplo <html lang="pt-BR">.',
          evidence: [{ viewport: vp, selector: 'html', measured: { lang: 'ausente' } }],
        }),
      );
    }
    const mv = snapshots.mobile?.metaViewport ?? snap.metaViewport;
    if (mv) {
      const noScale = /user-scalable\s*=\s*(no|0)/i.test(mv);
      const maxScale = /maximum-scale\s*=\s*([\d.]+)/i.exec(mv);
      if (noScale || (maxScale && Number(maxScale[1]) < 2)) {
        issues.push(
          issue({
            ruleId: 'a11y.zoom-disabled',
            category: 'accessibility',
            severity: 'high',
            title: 'Zoom bloqueado em dispositivos móveis',
            description: `A meta viewport impede que o usuário amplie a página ("${mv}"). Isso viola o critério WCAG 1.4.4.`,
            recommendation: 'Remova user-scalable=no e maximum-scale da meta viewport.',
            evidence: [{ viewport: 'mobile', selector: 'meta[name="viewport"]', measured: { content: mv } }],
          }),
        );
      }
    }
    if (snap.duplicateIds.length > 0) {
      issues.push(
        issue({
          ruleId: 'a11y.duplicate-ids',
          category: 'accessibility',
          severity: 'low',
          title: 'IDs duplicados no documento',
          description: `${plural(snap.duplicateIds.length, 'id aparece', 'ids aparecem')} mais de uma vez, o que quebra associações de label, aria-labelledby e âncoras.`,
          recommendation: 'Garanta que cada id seja único na página.',
          evidence: snap.duplicateIds.slice(0, 8).map((id) => ({ viewport: vp, selector: `[id="${id}"]`, measured: { id } })),
          occurrences: snap.duplicateIds.length,
        }),
      );
    }
    return issues;
  },
};

const headingOrderRule: Rule = {
  id: 'a11y.heading-order',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const headings = visible(snap)
      .filter((e) => e.headingLevel !== null)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const skips: Evidence[] = [];
    let prev = 0;
    for (const h of headings) {
      const level = h.headingLevel!;
      if (prev > 0 && level > prev + 1) {
        skips.push(evidenceFrom(vp, h, { level: `h${level}`, previous: `h${prev}` }));
      }
      prev = level;
    }
    if (skips.length === 0) return [];
    return [
      issue({
        ruleId: 'a11y.heading-order',
        category: 'accessibility',
        severity: 'low',
        title: 'Níveis de título pulados',
        description: `A estrutura de títulos salta níveis em ${plural(skips.length, 'ponto', 'pontos')} (ex.: h2 → h4). Quem navega por títulos perde a relação entre seções.`,
        recommendation: 'Use os níveis em sequência (h1 → h2 → h3) e controle o tamanho visual pelo CSS, não pela tag.',
        evidence: skips,
      }),
    ];
  },
};

const skipLinkRule: Rule = {
  id: 'a11y.skip-link',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    if (snap.skipLink || snap.navLinksVisible < 6) return [];
    return [
      issue({
        ruleId: 'a11y.skip-link',
        category: 'accessibility',
        severity: 'low',
        title: 'Sem atalho para pular a navegação',
        description: `A navegação tem ${snap.navLinksVisible} itens e não há link "Pular para o conteúdo". Usuários de teclado precisam atravessar todos eles em cada página.`,
        recommendation: 'Adicione como primeiro elemento focável um link "Pular para o conteúdo" que aponte para o <main>.',
        evidence: [{ viewport: vp, selector: 'nav', measured: { navLinks: snap.navLinksVisible, skipLink: false } }],
      }),
    ];
  },
};

export const accessibilityRules: Rule[] = [
  contrastRule,
  imgAltRule,
  unnamedControlRule,
  formLabelRule,
  docRule,
  headingOrderRule,
  skipLinkRule,
];
