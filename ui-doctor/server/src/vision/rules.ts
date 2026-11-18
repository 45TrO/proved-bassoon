import { parseColor, rgbToHsl } from '../analysis/color.js';
import type { Evidence } from '../domain/types.js';
import { contrastMargin, sampleTextColors } from './imageOps.js';
import { containment, round, toRaster, type Candidate, type Facts, type ImageFacts, type VisionRule } from './facts.js';

/**
 * Regras do sistema de visão. Cada uma consome fatos produzidos por OCR,
 * processamento de imagem, reconhecimento de padrões e parsing de DOM, e
 * propõe achados com confiança explícita. O monitor decide o destino de cada um.
 */
export const LIMITS = {
  /** Confiança mínima do OCR (0..100) para usar uma linha como evidência. */
  ocrLineConfidence: 75,
  /** Uniformidade mínima do fundo ao redor do texto para medir contraste por pixels. */
  backgroundUniformity: 0.5,
  /** Densidade de bordas na primeira dobra acima da qual a tela é considerada congestionada. */
  clutterDensity: 0.14,
  /** Proporção da dobra ocupada por blocos de conteúdo acima da qual falta respiro. */
  crowding: 0.88,
  /** Tamanho mínimo de fonte (px CSS) estimado para texto legível. */
  minFontSize: 11,
  /** Razão entre a maior linha de texto e a mediana abaixo da qual não há hierarquia clara. */
  hierarchyRatio: 1.45,
} as const;

/**
 * Estima o tamanho da fonte a partir da caixa do OCR, que cobre só os glifos presentes:
 * uma linha sem ascendentes ("para a sua casa") mede apenas a altura-x (~0,52 em).
 * Proporções típicas de fontes latinas: ascendente+descendente ≈ 0,95 em, só ascendente
 * ou maiúsculas ≈ 0,74 em, só descendente ≈ 0,72 em.
 */
const ASCENDERS = /[A-ZÀ-ÝbdfhkltÁÉÍÓÚÂÊÔÃÕÇ0-9!?&%$#@()/\\[\]{}|]/;

/** Linhas com ascendentes ou maiúsculas têm altura confiável para estimar a fonte. */
export const hasAscenders = (text: string) => ASCENDERS.test(text);

export function estimateFontSize(text: string, boxHeight: number): number {
  const asc = ASCENDERS.test(text);
  const desc = /[gjpqyç(),;\[\]{}|]/.test(text);
  const ratio = asc && desc ? 0.95 : asc ? 0.74 : desc ? 0.72 : 0.52;
  return boxHeight / ratio;
}

const GENERIC = /^(clique aqui|clique|aqui|saiba mais|leia mais|veja mais|ver mais|click here|read more|learn more|more|ok|enviar|submit)\.?$/i;

function lineEvidence(img: ImageFacts, box: { x: number; y: number; width: number; height: number }, text: string, measured: Evidence['measured']): Evidence {
  return { viewport: img.viewport, rect: round(box), snippet: text.slice(0, 90), measured };
}

const ocrContrast: VisionRule = {
  id: 'vision.ocr-contrast',
  sources: ['url', 'image'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      const evidence: (Evidence & { ratio: number })[] = [];
      let confSum = 0;
      for (const line of img.ocr.lines) {
        if (line.confidence < LIMITS.ocrLineConfidence || line.text.replace(/\W/g, '').length < 3) continue;
        const sample = sampleTextColors(img.raster, toRaster(line.box, img.raster.scale));
        if (!sample || sample.backgroundUniformity < LIMITS.backgroundUniformity) continue;
        const cssHeight = line.box.height / img.dpr;
        const fontSize = estimateFontSize(line.text, cssHeight);
        const large = fontSize >= 24;
        const required = large ? 3 : 4.5;
        // Só aponta quando falha mesmo com a margem de erro calibrada para este tamanho.
        if (sample.ratio >= required * (1 - contrastMargin(line.box.height))) continue;
        // Glifos finos (< 14 px) nunca atingem a cor plena por causa da suavização: menor confiança.
        const thin = cssHeight < 14 ? 0.8 : 1;
        confSum += (line.confidence / 100) * Math.min(1, sample.backgroundUniformity * 1.25) * thin;
        evidence.push({
          ...lineEvidence(img, line.box, line.text, {
            ratio: sample.ratio,
            required,
            foreground: sample.foreground,
            background: sample.background,
            fonteEstimada: `${Math.round(fontSize)}px`,
            confiançaOCR: `${Math.round(line.confidence)}%`,
          }),
          ratio: sample.ratio,
        });
      }
      if (evidence.length === 0) continue;
      evidence.sort((a, b) => a.ratio - b.ratio);
      const worst = evidence[0]!.ratio;
      out.push({
        rule: this.id,
        category: 'accessibility',
        severity: worst < 2 ? 'critical' : worst < 3 ? 'high' : 'medium',
        title: 'Texto com contraste insuficiente (medido nos pixels)',
        description: `O OCR localizou ${evidence.length} linha(s) de texto cujo contraste real na imagem fica abaixo do mínimo WCAG. O pior caso mede ${worst}:1.`,
        recommendation: 'Escureça o texto ou clareie o fundo mantendo o matiz até 4.5:1 (3:1 para texto grande).',
        evidence: evidence.map(({ ratio: _r, ...e }) => e),
        confidence: confSum / evidence.length,
        modules: ['OCR', 'Imagem'],
      });
    }
    return out;
  },
};

const textInImage: VisionRule = {
  id: 'vision.text-in-image',
  sources: ['url'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      if (img.viewport === 'image') continue;
      const snap = f.snapshots[img.viewport];
      if (!snap) continue;
      const evidence: Evidence[] = [];
      for (const el of snap.elements) {
        if (el.hidden || !(el.tag === 'img' || (el.bgImage && el.words === 0 && el.kind === 'container')) || el.w * el.h < 80 * 40) continue;
        const rect = { x: el.x, y: el.y, width: el.w, height: el.h };
        if (rect.y > img.height) continue;
        const words = img.ocr.lines.flatMap((l) => l.words).filter((w) => w.confidence >= 80 && w.text.length >= 3 && containment(w.box, rect) > 0.9);
        if (words.length < 3) continue;
        const alt = (el.imgAlt ?? el.name ?? '').toLowerCase();
        const covered = words.filter((w) => alt.includes(w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))).length;
        if (covered / words.length >= 0.5) continue;
        evidence.push({
          viewport: img.viewport,
          selector: el.selector,
          rect,
          snippet: words.map((w) => w.text).join(' ').slice(0, 90),
          measured: { palavrasNaImagem: words.length, cobertasPeloAlt: covered, alt: el.imgAlt ?? 'ausente' },
        });
      }
      if (evidence.length) {
        out.push({
          rule: this.id,
          category: 'accessibility',
          severity: 'medium',
          title: 'Texto embutido em imagem',
          description: `${evidence.length} imagem(ns) contêm texto legível (lido por OCR) que não está disponível como texto na página nem no atributo alt.`,
          recommendation: 'Coloque o texto em HTML real sobre a imagem, ou repita o conteúdo integralmente no alt. Texto em imagem não escala, não traduz e não é lido por leitores de tela.',
          evidence,
          confidence: 0.85,
          modules: ['OCR', 'DOM'],
        });
      }
    }
    return out;
  },
};

const tinyText: VisionRule = {
  id: 'vision.tiny-text',
  sources: ['image'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      const tiny = img.ocr.lines.filter((l) => l.confidence >= 60 && l.words.length >= 3 && hasAscenders(l.text) && estimateFontSize(l.text, l.box.height / img.dpr) < LIMITS.minFontSize);
      if (tiny.length === 0) continue;
      out.push({
        rule: this.id,
        category: 'visual',
        severity: tiny.length > 4 ? 'medium' : 'low',
        title: 'Texto pequeno demais',
        description: `${tiny.length} linha(s) de texto têm fonte estimada abaixo de ${LIMITS.minFontSize}px (densidade de pixels estimada ${img.dpr}×).`,
        recommendation: 'Use no mínimo 14 px para texto secundário e 16 px para texto corrido.',
        evidence: tiny.map((l) => lineEvidence(img, l.box, l.text, { fonteEstimada: `${Math.round(estimateFontSize(l.text, l.box.height / img.dpr))}px` })),
        confidence: img.dpr === 1 ? 0.8 : 0.7,
        modules: ['OCR'],
      });
    }
    return out;
  },
};

const genericLabels: VisionRule = {
  id: 'vision.generic-labels',
  sources: ['image'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      const generic = img.buttons.filter((b) => GENERIC.test(b.text.trim()));
      if (generic.length === 0) continue;
      out.push({
        rule: this.id,
        category: 'ux',
        severity: 'low',
        title: 'Botões com rótulo genérico',
        description: `${generic.length} botão(ões) reconhecidos na imagem usam rótulos como "${generic[0]!.text}", que não dizem o que vai acontecer.`,
        recommendation: 'Use verbos de resultado: "Criar conta", "Ver planos", "Enviar mensagem".',
        evidence: generic.map((b) => ({ viewport: img.viewport, rect: round(b.rect), snippet: b.text, measured: { rótulo: b.text } })),
        confidence: 0.8,
        modules: ['OCR', 'Padrões'],
      });
    }
    return out;
  },
};

const clutter: VisionRule = {
  id: 'vision.clutter',
  sources: ['url', 'image'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      if (img.edgeDensityFold <= LIMITS.clutterDensity) continue;
      out.push({
        rule: this.id,
        category: 'visual',
        severity: img.edgeDensityFold > LIMITS.clutterDensity * 1.5 ? 'medium' : 'low',
        title: 'Tela visualmente congestionada',
        description: `${Math.round(img.edgeDensityFold * 100)}% da primeira dobra é ocupada por contornos (texto, bordas, ícones, texturas). Acima de ${Math.round(LIMITS.clutterDensity * 100)}% a busca visual fica lenta e nada se destaca.`,
        recommendation: 'Reduza elementos concorrentes acima da dobra, remova bordas e texturas decorativas e agrupe informações relacionadas.',
        evidence: [{ viewport: img.viewport, rect: { x: 0, y: 0, width: img.width, height: Math.round(img.fold) }, measured: { densidadeDeBordas: `${Math.round(img.edgeDensityFold * 100)}%`, limite: `${Math.round(LIMITS.clutterDensity * 100)}%` } }],
        confidence: 0.75,
        modules: ['Imagem'],
      });
    }
    return out;
  },
};

const crowding: VisionRule = {
  id: 'vision.crowding',
  sources: ['url', 'image'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      if (img.foregroundFold <= LIMITS.crowding) continue;
      out.push({
        rule: this.id,
        category: 'visual',
        severity: 'low',
        title: 'Pouco espaço em branco',
        description: `Blocos de conteúdo cobrem ${Math.round(img.foregroundFold * 100)}% da primeira dobra. Sem respiro, a hierarquia e os agrupamentos se perdem.`,
        recommendation: 'Aumente margens entre seções e o espaço interno dos agrupamentos; priorize menos conteúdo por tela.',
        evidence: [{ viewport: img.viewport, rect: { x: 0, y: 0, width: img.width, height: Math.round(img.fold) }, measured: { ocupação: `${Math.round(img.foregroundFold * 100)}%`, blocos: img.blocks.length } }],
        confidence: 0.7,
        modules: ['Imagem'],
      });
    }
    return out;
  },
};

const imageAlignment: VisionRule = {
  id: 'vision.alignment',
  sources: ['image'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      const textBlocks = img.ocr.lines.filter((l) => l.confidence >= 70 && l.words.length >= 2).map((l) => l.box);
      const counts = new Map<number, number>();
      for (const b of textBlocks) counts.set(Math.round(b.x), (counts.get(Math.round(b.x)) ?? 0) + 1);
      // Âncoras: bordas usadas por ≥ 3 linhas (tolerância de 1 px do OCR).
      const anchors = [...counts.keys()].filter((x) => (counts.get(x) ?? 0) + (counts.get(x - 1) ?? 0) + (counts.get(x + 1) ?? 0) >= 4);
      const off = textBlocks.filter((b) => {
        const x = Math.round(b.x);
        if (anchors.some((a) => Math.abs(a - x) <= 2)) return false;
        return anchors.some((a) => Math.abs(a - x) >= 5 * img.dpr && Math.abs(a - x) <= 10 * img.dpr);
      });
      // Exige uma "coluna" deslocada: ≥ 2 linhas começando na mesma posição fora do grid.
      const offCounts = new Map<number, number>();
      for (const b of off) offCounts.set(Math.round(b.x / 2), (offCounts.get(Math.round(b.x / 2)) ?? 0) + 1);
      if (off.length < 3 || ![...offCounts.values()].some((n) => n >= 2)) continue;
      out.push({
        rule: this.id,
        category: 'visual',
        severity: 'low',
        title: 'Textos quase alinhados',
        description: `${off.length} linha(s) de texto começam alguns pixels fora das linhas de alinhamento dominantes da tela.`,
        recommendation: 'Alinhe os blocos de texto à mesma borda do grid.',
        evidence: off.slice(0, 10).map((b) => ({ viewport: img.viewport, rect: round(b), measured: { bordaEsquerda: Math.round(b.x) } })),
        occurrences: off.length,
        confidence: 0.7,
        modules: ['OCR', 'Imagem'],
      });
    }
    return out;
  },
};

const hierarchy: VisionRule = {
  id: 'vision.hierarchy',
  sources: ['image'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      const lines = img.ocr.lines.filter((l) => l.confidence >= 70 && l.words.length >= 1);
      if (lines.length < 6) continue;
      const heights = lines.map((l) => l.box.height).sort((a, b) => a - b);
      const median = heights[Math.floor(heights.length / 2)]!;
      const max = heights[heights.length - 1]!;
      if (max / median >= LIMITS.hierarchyRatio) continue;
      out.push({
        rule: this.id,
        category: 'visual',
        severity: 'medium',
        title: 'Sem hierarquia tipográfica clara',
        description: `O maior texto da tela tem só ${(max / median).toFixed(2)}× a altura do texto comum. Sem um título dominante, o olhar não sabe por onde começar.`,
        recommendation: 'Destaque um título principal com tamanho bem maior (≥ 2× o corpo) e use peso e espaçamento para os níveis seguintes.',
        evidence: [{ viewport: img.viewport, rect: round(lines.reduce((a, l) => (l.box.height > a.height ? l.box : a), lines[0]!.box)), measured: { maiorLinha: `${Math.round(max)}px`, medianaDasLinhas: `${Math.round(median)}px` } }],
        confidence: 0.75,
        modules: ['OCR'],
      });
    }
    return out;
  },
};

const ctaCompetition: VisionRule = {
  id: 'vision.cta-competition',
  sources: ['url', 'image'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      const inFold = img.buttons.filter((b) => b.rect.y < img.fold);
      const fills = new Map<string, typeof inFold>();
      for (const b of inFold) {
        const c = parseColor(b.fill);
        if (!c) continue;
        const hsl = rgbToHsl(c);
        if (hsl.s < 0.35 || hsl.l < 0.15 || hsl.l > 0.85) continue; // só preenchimentos cromáticos chamam atenção
        const key = `${Math.round(hsl.h / 25)}`;
        fills.set(key, [...(fills.get(key) ?? []), b]);
      }
      if (fills.size < 3) continue;
      out.push({
        rule: this.id,
        category: 'ux',
        severity: 'medium',
        title: 'Ações principais competindo entre si',
        description: `Na primeira dobra há botões preenchidos em ${fills.size} cores fortes diferentes. Com vários "botões principais", nenhum é principal.`,
        recommendation: 'Defina uma cor para a ação primária; ações secundárias em contorno ou texto.',
        evidence: [...fills.values()].map((bs) => ({ viewport: img.viewport, rect: round(bs[0]!.rect), snippet: bs[0]!.text, measured: { preenchimento: bs[0]!.fill } })),
        confidence: 0.75,
        modules: ['Padrões', 'Imagem'],
      });
    }
    return out;
  },
};

const imageButtons: VisionRule = {
  id: 'vision.button-patterns',
  sources: ['image'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      const cssWidth = img.width / img.dpr;
      const small = cssWidth <= 600 ? img.buttons.filter((b) => b.rect.height / img.dpr < 32) : [];
      if (small.length) {
        out.push({
          rule: `${this.id}:small`,
          category: 'ux',
          severity: 'medium',
          title: 'Botões pequenos para toque',
          description: `${small.length} botão(ões) reconhecidos têm menos de 32 px de altura em uma tela de ${Math.round(cssWidth)} px de largura.`,
          recommendation: 'Garanta área de toque de no mínimo 44×44 px.',
          evidence: small.map((b) => ({ viewport: img.viewport, rect: round(b.rect), snippet: b.text, measured: { altura: `${Math.round(b.rect.height / img.dpr)}px` } })),
          confidence: 0.7,
          modules: ['Padrões'],
        });
      }
      if (img.buttons.length >= 3) {
        const heights = [...new Set(img.buttons.map((b) => Math.round(b.rect.height / img.dpr / 4) * 4))];
        if (heights.length >= 3) {
          out.push({
            rule: `${this.id}:variants`,
            category: 'visual',
            severity: 'low',
            title: 'Botões com tamanhos inconsistentes',
            description: `Os ${img.buttons.length} botões reconhecidos usam ${heights.length} alturas diferentes (${heights.sort((a, b) => a - b).map((h) => `${h}px`).join(', ')}).`,
            recommendation: 'Padronize 2 ou 3 tamanhos de botão e reutilize-os.',
            evidence: img.buttons.slice(0, 8).map((b) => ({ viewport: img.viewport, rect: round(b.rect), snippet: b.text, measured: { altura: `${Math.round(b.rect.height / img.dpr)}px` } })),
            confidence: 0.7,
            modules: ['Padrões'],
          });
        }
      }
    }
    return out;
  },
};

const navOverload: VisionRule = {
  id: 'vision.nav-overload',
  sources: ['image'],
  run(f) {
    const out: Candidate[] = [];
    for (const img of f.images) {
      if (img.nav.count <= 8 || !img.nav.rect) continue;
      out.push({
        rule: this.id,
        category: 'ux',
        severity: 'low',
        title: 'Menu com opções demais',
        description: `A barra superior reconhecida tem ${img.nav.count} itens (${img.nav.items.slice(0, 6).join(', ')}…).`,
        recommendation: 'Mantenha de 5 a 7 itens de primeiro nível e agrupe o restante.',
        evidence: [{ viewport: img.viewport, rect: round(img.nav.rect), measured: { itens: img.nav.count } }],
        confidence: 0.75,
        modules: ['OCR', 'Padrões'],
      });
    }
    return out;
  },
};

const componentVariants: VisionRule = {
  id: 'vision.component-variants',
  sources: ['url'],
  run(f) {
    if (f.variants.length === 0) return [];
    return [
      {
        rule: this.id,
        category: 'visual',
        severity: 'low',
        title: 'Variantes acidentais de componentes',
        description: `${f.variants.length} componente(s) diferem do padrão dominante do mesmo tipo em poucos pixels ou num tom de cor, sinal de estilos duplicados em vez de reutilizados.`,
        recommendation: 'Reutilize a mesma classe/componente; elimine as variações mínimas.',
        evidence: f.variants.slice(0, 10).map((v) => ({
          viewport: 'desktop' as const,
          selector: v.outlier.selector,
          rect: { x: v.outlier.x, y: v.outlier.y, width: v.outlier.w, height: v.outlier.h },
          snippet: v.outlier.text || v.outlier.name,
          measured: { tipo: v.kind, diferenças: v.differences.join('; '), padrão: `${v.dominant.signature} (${v.dominant.count}×)` },
        })),
        confidence: 0.85,
        modules: ['Padrões', 'DOM'],
      },
    ];
  },
};

const domStatic: VisionRule = {
  id: 'vision.dom',
  sources: ['url'],
  run(f) {
    const d = f.dom;
    if (!d) return [];
    const out: Candidate[] = [];
    const base = { confidence: 0.95, modules: ['DOM' as const] };
    const ev = (measured: Evidence['measured'], selector = 'html'): Evidence[] => [{ viewport: 'desktop', selector, measured }];
    if (!d.title) {
      out.push({ ...base, rule: 'vision.dom:title', category: 'ux', severity: 'medium', title: 'Página sem título', description: 'O documento não tem <title>. A aba, o histórico e os resultados de busca ficam sem identificação.', recommendation: 'Defina um título único e descritivo, com até ~60 caracteres.', evidence: ev({ title: 'ausente' }, 'head') });
    } else if (d.title.length > 70) {
      out.push({ ...base, rule: 'vision.dom:title-long', category: 'ux', severity: 'low', title: 'Título da página longo demais', description: `O <title> tem ${d.title.length} caracteres e será cortado na aba e na busca.`, recommendation: 'Reduza para até ~60 caracteres, com o essencial no começo.', evidence: ev({ caracteres: d.title.length, título: d.title.slice(0, 80) }, 'title') });
    }
    if (!d.metaDescription) {
      out.push({ ...base, rule: 'vision.dom:description', category: 'ux', severity: 'low', title: 'Sem meta description', description: 'Sem descrição, buscadores e redes sociais montam o resumo da página com trechos aleatórios.', recommendation: 'Adicione <meta name="description"> com 120–160 caracteres sobre o que a página oferece.', evidence: ev({ metaDescription: 'ausente' }, 'head') });
    }
    const deprecated = Object.entries(d.deprecatedTags);
    if (deprecated.length) {
      out.push({ ...base, rule: 'vision.dom:deprecated', category: 'visual', severity: 'low', title: 'Marcação HTML obsoleta', description: `A página usa elementos obsoletos para aparência: ${deprecated.map(([t, n]) => `<${t}> ×${n}`).join(', ')}.`, recommendation: 'Substitua por CSS; elementos obsoletos ignoram o sistema de estilos e geram inconsistência.', evidence: ev(Object.fromEntries(deprecated)) });
    }
    if (d.positiveTabindex.length) {
      out.push({ ...base, rule: 'vision.dom:tabindex', category: 'accessibility', severity: 'medium', title: 'Ordem de tabulação forçada', description: `${d.positiveTabindex.length} elemento(s) usam tabindex positivo, o que desorganiza a navegação por teclado.`, recommendation: 'Use tabindex="0" ou "-1" e ordene o foco pela ordem do HTML.', evidence: ev({ exemplos: d.positiveTabindex.slice(0, 4).join(' ') }) });
    }
    if (d.iframesWithoutTitle) {
      out.push({ ...base, rule: 'vision.dom:iframe', category: 'accessibility', severity: 'low', title: 'Iframes sem título', description: `${d.iframesWithoutTitle} iframe(s) sem atributo title; leitores de tela anunciam apenas "frame".`, recommendation: 'Descreva o conteúdo de cada iframe no atributo title.', evidence: ev({ iframes: d.iframesWithoutTitle }, 'iframe') });
    }
    if (d.autoplayMedia) {
      out.push({ ...base, rule: 'vision.dom:autoplay', category: 'ux', severity: 'medium', title: 'Mídia com som em reprodução automática', description: `${d.autoplayMedia} vídeo/áudio inicia sozinho sem estar mudo.`, recommendation: 'Remova autoplay ou inicie mudo, com controles visíveis.', evidence: ev({ mídias: d.autoplayMedia }, 'video') });
    }
    if (d.blankTargetsWithoutRel >= 1) {
      out.push({ ...base, rule: 'vision.dom:blank', category: 'ux', severity: 'low', title: 'Links que abrem nova aba sem aviso', description: `${d.blankTargetsWithoutRel} link(s) com target="_blank" sem rel="noopener" e sem indicação de que abrem outra aba.`, recommendation: 'Adicione rel="noopener" e indique visualmente (ícone ou texto) que o link abre em nova aba.', evidence: ev({ links: d.blankTargetsWithoutRel }, 'a[target="_blank"]') });
    }
    if (d.images >= 3 && d.imagesWithoutDimensions / d.images > 0.5) {
      out.push({ ...base, rule: 'vision.dom:img-dimensions', category: 'visual', severity: 'low', title: 'Imagens sem dimensões declaradas', description: `${d.imagesWithoutDimensions} de ${d.images} imagens não declaram width/height, o que faz o layout "pular" enquanto carregam.`, recommendation: 'Declare width e height (ou aspect-ratio) em todas as imagens.', evidence: ev({ semDimensões: d.imagesWithoutDimensions, total: d.images }, 'img') });
    }
    if (d.emptyLinks) {
      out.push({ ...base, rule: 'vision.dom:empty-links', category: 'accessibility', severity: 'medium', title: 'Links vazios no código', description: `${d.emptyLinks} link(s) não têm texto, rótulo nem imagem com alt.`, recommendation: 'Dê a cada link um texto ou aria-label que descreva o destino.', evidence: ev({ links: d.emptyLinks }, 'a') });
    }
    if (d.clickableDivs) {
      out.push({ ...base, rule: 'vision.dom:clickable-div', category: 'accessibility', severity: 'medium', title: 'Elementos clicáveis que não são botões', description: `${d.clickableDivs} div/span com onclick, sem papel nem foco de teclado.`, recommendation: 'Use <button> ou adicione role="button", tabindex="0" e suporte a Enter/Espaço.', evidence: ev({ elementos: d.clickableDivs }) });
    }
    if (d.elements > 100 && d.inlineStyles > 40 && d.inlineStyles / d.elements > 0.15) {
      out.push({ ...base, rule: 'vision.dom:inline-styles', category: 'visual', severity: 'low', title: 'Estilos inline em excesso', description: `${d.inlineStyles} de ${d.elements} elementos têm style="" próprio, o que espalha decisões visuais e gera inconsistência.`, recommendation: 'Concentre estilos em classes e tokens reutilizáveis.', evidence: ev({ inline: d.inlineStyles, elementos: d.elements }) });
    }
    return out;
  },
};

export const VISION_RULES: VisionRule[] = [
  ocrContrast,
  textInImage,
  tinyText,
  genericLabels,
  clutter,
  crowding,
  imageAlignment,
  hierarchy,
  ctaCompetition,
  imageButtons,
  navOverload,
  componentVariants,
  domStatic,
];

export type { Facts };
