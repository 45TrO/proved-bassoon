import type { SnapEl } from '../../capture/snapshot.js';
import type { Evidence, Issue } from '../../domain/types.js';
import { evidenceFrom, issue, plural, primary, textElements, visible, type Rule } from './helpers.js';

/**
 * Desalinhamento: bordas esquerdas de blocos de conteúdo que ficam a 1–8 px de
 * uma linha de alinhamento dominante (usada por ≥ 4 elementos). Diferenças tão
 * pequenas quase nunca são intencionais e criam "ruído" na grade.
 */
const alignmentRule: Rule = {
  id: 'visual.alignment',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const vw = snap.viewport.width;
    const candidates = visible(snap).filter(
      (e) =>
        // Imagens ficam de fora: molduras internas em cards recuam a imagem de propósito.
        (e.kind === 'heading' || e.kind === 'text' || e.kind === 'button') &&
        e.display !== 'inline' &&
        e.position !== 'fixed' &&
        e.position !== 'absolute' &&
        e.textAlign !== 'center' &&
        e.w < vw * 0.9 &&
        e.x > 0,
    );
    const counts = new Map<number, number>();
    for (const e of candidates) counts.set(e.x, (counts.get(e.x) ?? 0) + 1);
    const anchors = [...counts.entries()].filter(([, c]) => c >= 4).map(([x]) => x);
    const evidence: Evidence[] = [];
    let occurrences = 0;
    for (const e of candidates) {
      if (counts.get(e.x)! >= 4) continue;
      const near = anchors
        .map((a) => ({ a, d: Math.abs(a - e.x) }))
        .filter(({ d }) => d >= 1 && d <= 8)
        .sort((x, y) => x.d - y.d)[0];
      if (!near) continue;
      // Precisa estar na mesma faixa vertical (até 1200 px) de algum elemento da âncora.
      const sameRegion = candidates.some((o) => o.x === near.a && Math.abs(o.y - e.y) < 1200);
      if (!sameRegion) continue;
      occurrences++;
      if (evidence.length < 12) {
        evidence.push(evidenceFrom(vp, e, { left: e.x, expectedLeft: near.a, offset: `${e.x - near.a > 0 ? '+' : ''}${e.x - near.a}px` }));
      }
    }
    if (occurrences < 2) return [];
    return [
      issue({
        ruleId: 'visual.alignment',
        category: 'visual',
        severity: occurrences > 8 ? 'medium' : 'low',
        title: 'Elementos quase alinhados',
        description: `${plural(occurrences, 'elemento está', 'elementos estão')} entre 1 e 8 px fora da linha de alinhamento dominante da página. São desvios pequenos demais para parecerem intencionais.`,
        recommendation: 'Alinhe esses elementos à mesma borda do grid (container com padding único) e evite margens avulsas que deslocam blocos em poucos pixels.',
        evidence,
        occurrences,
      }),
    ];
  },
};

/** Espaçamento: valores fora de uma escala de 4 px e ritmos vertical irregulares entre irmãos. */
const spacingRule: Rule = {
  id: 'visual.spacing',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const els = visible(snap);
    const issues: Issue[] = [];

    // 1) Ritmo vertical: irmãos empilhados com gaps muito diferentes entre si.
    const byParent = new Map<number, SnapEl[]>();
    for (const e of els) {
      if (e.parent < 0 || e.position === 'absolute' || e.position === 'fixed' || e.display === 'inline') continue;
      const list = byParent.get(e.parent) ?? [];
      list.push(e);
      byParent.set(e.parent, list);
    }
    const rhythm: Evidence[] = [];
    let rhythmCount = 0;
    for (const [parentIdx, children] of byParent) {
      if (children.length < 4) continue;
      const stack = [...children].sort((a, b) => a.y - b.y);
      const gaps: number[] = [];
      let vertical = true;
      for (let k = 1; k < stack.length; k++) {
        const prev = stack[k - 1]!;
        const cur = stack[k]!;
        const gap = cur.y - (prev.y + prev.h);
        const overlapX = Math.min(prev.x + prev.w, cur.x + cur.w) - Math.max(prev.x, cur.x);
        if (gap < 0 || overlapX <= 0) {
          vertical = false;
          break;
        }
        gaps.push(gap);
      }
      if (!vertical || gaps.length < 3) continue;
      const distinct = [...new Set(gaps.map((g) => Math.round(g / 2) * 2))];
      const spread = Math.max(...gaps) - Math.min(...gaps);
      // Ritmo irregular: ≥ 3 valores diferentes e variação > 12 px entre itens do mesmo grupo.
      if (distinct.length >= 3 && spread > 12) {
        rhythmCount++;
        const parent = els.find((e) => e.i === parentIdx) ?? stack[0]!;
        if (rhythm.length < 10) {
          rhythm.push(evidenceFrom(vp, parent, { gaps: gaps.map((g) => `${g}px`).join(', '), spread: `${spread}px` }));
        }
      }
    }
    if (rhythmCount > 0) {
      issues.push(
        issue({
          ruleId: 'visual.spacing-rhythm',
          category: 'visual',
          severity: rhythmCount > 4 ? 'medium' : 'low',
          title: 'Espaçamento vertical irregular',
          description: `${plural(rhythmCount, 'grupo de elementos empilhados usa', 'grupos de elementos empilhados usam')} distâncias diferentes entre itens equivalentes, quebrando o ritmo de leitura.`,
          recommendation: 'Padronize o espaço entre itens do mesmo grupo com gap (flex/grid) ou com um único token de espaçamento (ex.: 16 px, 24 px).',
          evidence: rhythm,
          occurrences: rhythmCount,
        }),
      );
    }

    // 2) Escala: margens e paddings de 3 a 64 px (os tokens de espaçamento; valores maiores
    // costumam ser centralização automática) comparados a uma escala comum: múltiplos de 4,
    // com meios-passos de 2 px até 16 px (4, 6, 8, 10, 12, 14, 16, 20, 24…).
    const onScale = (v: number) => v % 4 === 0 || (v <= 16 && v % 2 === 0);
    const values: number[] = [];
    for (const e of els) for (const v of [...e.margin, ...e.padding]) if (v >= 3 && v <= 64) values.push(v);
    if (values.length >= 40) {
      const off = values.filter((v) => !onScale(v));
      const ratio = off.length / values.length;
      if (ratio > 0.2) {
        const freq = new Map<number, number>();
        for (const v of off) freq.set(v, (freq.get(v) ?? 0) + 1);
        const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        issues.push(
          issue({
            ruleId: 'visual.spacing-scale',
            category: 'visual',
            severity: ratio > 0.45 ? 'medium' : 'low',
            title: 'Espaçamentos fora de uma escala consistente',
            description: `${Math.round(ratio * 100)}% dos espaçamentos entre 3 e 64 px (${off.length} de ${values.length}) não seguem uma escala regular. Valores mais frequentes fora da escala: ${top.map(([v]) => `${v}px`).join(', ')}.`,
            recommendation: 'Adote uma escala de espaçamento (4, 8, 12, 16, 24, 32, 48, 64, com meios-passos de 2 px só em componentes pequenos) e troque os valores avulsos pelo token mais próximo.',
            evidence: [{ viewport: vp, measured: { offScale: off.length, total: values.length, examples: top.map(([v, c]) => `${v}px ×${c}`).join(', ') } }],
            occurrences: off.length,
          }),
        );
      }
    }
    return issues;
  },
};

/** Hierarquia tipográfica: h1, ordem de tamanhos e quantidade de tamanhos. */
const hierarchyRule: Rule = {
  id: 'visual.hierarchy',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const issues: Issue[] = [];
    const headings = visible(snap).filter((e) => e.headingLevel !== null);
    const h1 = headings.filter((h) => h.headingLevel === 1);
    if (h1.length === 0) {
      issues.push(
        issue({
          ruleId: 'visual.h1-missing',
          category: 'visual',
          severity: 'medium',
          title: 'Página sem título principal (h1)',
          description: 'Nenhum h1 visível foi encontrado. A página não comunica um assunto principal, nem para pessoas nem para mecanismos de busca.',
          recommendation: 'Defina um único h1 que descreva a proposta da página, posicionado no topo do conteúdo principal.',
          evidence: [{ viewport: vp, measured: { h1: 0, headings: headings.length } }],
        }),
      );
    } else if (h1.length > 1) {
      issues.push(
        issue({
          ruleId: 'visual.h1-multiple',
          category: 'visual',
          severity: 'low',
          title: 'Múltiplos títulos principais',
          description: `Foram encontrados ${h1.length} h1 visíveis. Os títulos competem entre si e diluem a hierarquia.`,
          recommendation: 'Mantenha um h1 e rebaixe os demais para h2.',
          evidence: h1.map((h) => evidenceFrom(vp, h, { fontSize: `${h.fontSize}px` })),
        }),
      );
    }

    // Tamanho médio por nível deve decrescer (h1 > h2 > h3).
    const avg = (lvl: number) => {
      const xs = headings.filter((h) => h.headingLevel === lvl).map((h) => h.fontSize);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const inversions: Evidence[] = [];
    for (let lvl = 2; lvl <= 6; lvl++) {
      // Compara com o nível superior mais próximo que existe na página (h4 → h3 ou h2...).
      let upperLevel = lvl - 1;
      let upper = avg(upperLevel);
      while (upper === null && upperLevel > 1) upper = avg(--upperLevel);
      if (upper === null) continue;
      for (const h of headings.filter((x) => x.headingLevel === lvl)) {
        if (h.fontSize > upper + 1) {
          inversions.push(
            evidenceFrom(vp, h, { level: `h${lvl}`, fontSize: `${h.fontSize}px`, comparedTo: `h${upperLevel} (${Math.round(upper)}px)` }),
          );
        }
      }
    }
    if (inversions.length > 0) {
      issues.push(
        issue({
          ruleId: 'visual.hierarchy-inverted',
          category: 'visual',
          severity: 'medium',
          title: 'Hierarquia tipográfica invertida',
          description: `${plural(inversions.length, 'título de nível inferior é', 'títulos de nível inferior são')} maiores que o nível acima, o que confunde a ordem de importância.`,
          recommendation: 'Defina uma escala tipográfica (ex.: razão 1.25) em que cada nível de título seja visivelmente menor que o anterior.',
          evidence: inversions,
        }),
      );
    }

    const sizes = new Map<number, number>();
    for (const t of textElements(snap)) {
      const s = Math.round(t.fontSize);
      sizes.set(s, (sizes.get(s) ?? 0) + 1);
    }
    const meaningful = [...sizes.entries()].filter(([, c]) => c >= 2).map(([s]) => s).sort((a, b) => a - b);
    if (meaningful.length > 9) {
      issues.push(
        issue({
          ruleId: 'visual.type-scale',
          category: 'visual',
          severity: meaningful.length > 13 ? 'medium' : 'low',
          title: 'Tamanhos de fonte demais',
          description: `A página usa ${meaningful.length} tamanhos de fonte recorrentes (${meaningful.map((s) => `${s}px`).join(', ')}). O excesso enfraquece o contraste entre níveis.`,
          recommendation: 'Reduza para 5 a 7 tamanhos em uma escala modular e aplique-os por tokens.',
          evidence: [{ viewport: vp, measured: { sizes: meaningful.join(', '), count: meaningful.length } }],
          occurrences: meaningful.length,
        }),
      );
    }

    const tinyBody = textElements(snap).filter((t) => t.words >= 12 && t.fontSize < 14 && t.kind === 'text');
    if (tinyBody.length > 0 && vp === 'desktop') {
      issues.push(
        issue({
          ruleId: 'visual.small-body',
          category: 'visual',
          severity: tinyBody.length > 5 ? 'medium' : 'low',
          title: 'Texto corrido muito pequeno',
          description: `${plural(tinyBody.length, 'bloco de texto usa', 'blocos de texto usam')} fonte menor que 14 px no desktop.`,
          recommendation: 'Use 16 px (mínimo 15 px) para texto corrido e reserve tamanhos menores para legendas.',
          evidence: tinyBody.map((t) => evidenceFrom(vp, t, { fontSize: `${t.fontSize}px`, words: t.words })),
        }),
      );
    }
    return issues;
  },
};

/** Excesso de informação acima da dobra. */
const densityRule: Rule = {
  id: 'visual.density',
  run(snapshots) {
    const issues: Issue[] = [];
    for (const vp of ['desktop', 'mobile'] as const) {
      const snap = snapshots[vp];
      if (!snap) continue;
      const fold = snap.viewport.height;
      const els = visible(snap).filter((e) => e.y < fold && e.y + e.h > 0);
      const words = els.filter((e) => e.ownText).reduce((a, e) => a + e.words, 0);
      const interactive = els.filter((e) => e.interactive).length;
      const wordLimit = vp === 'desktop' ? 260 : 150;
      const ctaLimit = vp === 'desktop' ? 35 : 18;
      if (words > wordLimit || interactive > ctaLimit) {
        issues.push(
          issue({
            ruleId: 'visual.density',
            viewport: vp,
            category: 'visual',
            severity: words > wordLimit * 1.6 || interactive > ctaLimit * 1.6 ? 'medium' : 'low',
            title: vp === 'desktop' ? 'Excesso de informação na primeira dobra' : 'Primeira tela do mobile sobrecarregada',
            description: `A área visível sem rolar (${snap.viewport.width}×${fold}) contém ${words} palavras e ${interactive} elementos interativos. O usuário precisa processar muitas opções antes de entender a proposta.`,
            recommendation: 'Priorize título, proposta de valor e uma ação principal. Mova conteúdos secundários para baixo da dobra ou para páginas internas.',
            evidence: [{ viewport: vp, rect: { x: 0, y: 0, width: snap.viewport.width, height: fold }, measured: { words, interactive, wordLimit, ctaLimit } }],
          }),
        );
      }
    }
    return issues;
  },
};

/** Imagens ampliadas além da resolução nativa ou com proporção distorcida. */
const proportionRule: Rule = {
  id: 'visual.proportion',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const upscaled: Evidence[] = [];
    const distorted: Evidence[] = [];
    for (const e of visible(snap)) {
      if (e.tag !== 'img' || e.imgVector || e.imgNaturalW === 0 || e.imgNaturalH === 0) continue;
      const scale = e.w / e.imgNaturalW;
      if (scale > 1.6 && e.w >= 160) {
        upscaled.push(evidenceFrom(vp, e, { natural: `${e.imgNaturalW}×${e.imgNaturalH}`, rendered: `${e.w}×${e.h}`, scale: `${scale.toFixed(1)}×` }));
      }
      if (e.objectFit === 'fill' || e.objectFit === '') {
        const natural = e.imgNaturalW / e.imgNaturalH;
        const rendered = e.w / e.h;
        const diff = Math.abs(rendered - natural) / natural;
        if (diff > 0.08 && e.w >= 48) {
          distorted.push(evidenceFrom(vp, e, { naturalRatio: natural.toFixed(2), renderedRatio: rendered.toFixed(2), distortion: `${Math.round(diff * 100)}%` }));
        }
      }
    }
    const issues: Issue[] = [];
    if (distorted.length) {
      issues.push(
        issue({
          ruleId: 'visual.img-distorted',
          category: 'visual',
          severity: 'medium',
          title: 'Imagens com proporção distorcida',
          description: `${plural(distorted.length, 'imagem está esticada ou achatada', 'imagens estão esticadas ou achatadas')} em relação ao arquivo original.`,
          recommendation: 'Use object-fit: cover (ou contain) e defina apenas uma das dimensões, deixando a outra como auto.',
          evidence: distorted,
          fixable: true,
        }),
      );
    }
    if (upscaled.length) {
      issues.push(
        issue({
          ruleId: 'visual.img-upscaled',
          category: 'visual',
          severity: 'low',
          title: 'Imagens ampliadas além da resolução',
          description: `${plural(upscaled.length, 'imagem é exibida', 'imagens são exibidas')} muito maior que o tamanho do arquivo, o que causa desfoque.`,
          recommendation: 'Forneça versões em maior resolução com srcset (1x/2x) ou limite a largura de exibição ao tamanho nativo.',
          evidence: upscaled,
        }),
      );
    }
    return issues;
  },
};

/** Consistência de componentes: variações de raio e altura entre botões e campos. */
const componentsRule: Rule = {
  id: 'visual.components',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const issues: Issue[] = [];
    const styled = visible(snap).filter((e) => {
      if (e.kind !== 'button' && !(e.kind === 'link' && e.display !== 'inline')) return false;
      const painted = e.ownBg && !/rgba\([^)]*,\s*0\)$/.test(e.ownBg);
      return painted || e.borderWidth > 0;
    });
    const group = (els: SnapEl[], key: (e: SnapEl) => number) => {
      const m = new Map<number, SnapEl[]>();
      for (const e of els) {
        const k = key(e);
        m.set(k, [...(m.get(k) ?? []), e]);
      }
      return m;
    };
    if (styled.length >= 4) {
      const radii = group(styled, (e) => e.radius);
      const heights = group(styled.filter((e) => e.h < 80), (e) => Math.round(e.h / 4) * 4);
      if (radii.size >= 4 || heights.size >= 5) {
        const ev: Evidence[] = [];
        for (const [r, list] of radii) ev.push(evidenceFrom(vp, list[0]!, { borderRadius: `${r}px`, height: `${list[0]!.h}px`, uses: list.length }));
        issues.push(
          issue({
            ruleId: 'visual.button-variants',
            category: 'visual',
            severity: radii.size >= 6 || heights.size >= 7 ? 'medium' : 'low',
            title: 'Botões inconsistentes entre si',
            description: `Os ${styled.length} botões estilizados usam ${radii.size} raios de borda e ${heights.size} alturas diferentes. O usuário não reconhece um padrão de ação.`,
            recommendation: 'Defina 2 ou 3 variantes de botão (primário, secundário, terciário) com altura e raio fixos e reutilize-as em todo o produto.',
            evidence: ev,
            occurrences: styled.length,
          }),
        );
      }
    }
    const fields = visible(snap).filter((e) => (e.kind === 'input' || e.kind === 'select' || e.kind === 'textarea') && e.inputType !== 'checkbox' && e.inputType !== 'radio');
    if (fields.length >= 3) {
      const heights = group(fields.filter((f) => f.kind !== 'textarea'), (e) => Math.round(e.h / 2) * 2);
      const radii = group(fields, (e) => e.radius);
      if (heights.size >= 3 || radii.size >= 3) {
        issues.push(
          issue({
            ruleId: 'visual.field-variants',
            category: 'visual',
            severity: 'low',
            title: 'Campos de formulário com estilos diferentes',
            description: `${fields.length} campos usam ${heights.size} alturas e ${radii.size} raios distintos.`,
            recommendation: 'Unifique altura, raio, borda e estado de foco dos campos em um componente único.',
            evidence: fields.slice(0, 8).map((f) => evidenceFrom(vp, f, { height: `${f.h}px`, borderRadius: `${f.radius}px` })),
            occurrences: fields.length,
          }),
        );
      }
    }
    return issues;
  },
};

export const visualRules: Rule[] = [alignmentRule, spacingRule, hierarchyRule, densityRule, proportionRule, componentsRule];
