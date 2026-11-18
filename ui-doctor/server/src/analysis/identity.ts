import type { Snapshot } from '../capture/snapshot.js';
import type { ContrastPair, IdentityReport, Issue, PaletteColor, SuggestedPalette, TypographyEntry } from '../domain/types.js';
import {
  bestTextOn,
  blend,
  deltaE2000,
  hslToRgb,
  parseColor,
  rgbToHsl,
  rgbToLab,
  round2,
  toHex,
  type RGBA,
} from './color.js';
import { elementContrast } from './rules/accessibility.js';
import { issue, plural, visible } from './rules/helpers.js';

interface Bucket {
  rgb: RGBA;
  hex: string;
  weight: number;
  roles: Map<PaletteColor['role'], number>;
}

function addColor(buckets: Bucket[], raw: string, weight: number, role: PaletteColor['role'], base?: RGBA) {
  const c = parseColor(raw);
  if (!c || c.a === 0 || weight <= 0) return;
  const rgb = c.a < 1 && base ? blend(c, base) : { ...c, a: 1 };
  const lab = rgbToLab(rgb);
  const existing = buckets.find((b) => deltaE2000(rgbToLab(b.rgb), lab) < 2.5);
  if (existing) {
    existing.weight += weight;
    existing.roles.set(role, (existing.roles.get(role) ?? 0) + weight);
    return;
  }
  buckets.push({ rgb, hex: toHex(rgb), weight, roles: new Map([[role, weight]]) });
}

function dominantRole(b: Bucket): PaletteColor['role'] {
  let best: PaletteColor['role'] = 'background';
  let w = -1;
  for (const [r, v] of b.roles) {
    if (v > w) {
      best = r;
      w = v;
    }
  }
  return best;
}

export function extractPalette(snap: Snapshot): { palette: PaletteColor[]; buckets: Bucket[] } {
  const els = visible(snap);
  const buckets: Bucket[] = [];
  const pageBg = parseColor(snap.pageBg) ?? { r: 255, g: 255, b: 255, a: 1 };
  const area = Math.max(1, snap.viewport.width * Math.min(snap.docHeight, 8000));
  addColor(buckets, snap.pageBg, area * 0.5, 'background');
  for (const e of els) {
    const own = parseColor(e.ownBg);
    if (own && own.a > 0.05) addColor(buckets, e.ownBg, e.w * e.h, 'background', pageBg);
    if (e.ownText && e.words > 0) addColor(buckets, e.color, e.words * e.fontSize * e.fontSize * 0.6, 'text', parseColor(e.bg) ?? pageBg);
    if (e.borderWidth > 0) addColor(buckets, e.borderColor, (e.w + e.h) * 2 * e.borderWidth, 'border', pageBg);
  }
  const total = buckets.reduce((a, b) => a + b.weight, 0) || 1;
  const sorted = buckets.sort((a, b) => b.weight - a.weight);
  const palette: PaletteColor[] = sorted.slice(0, 10).map((b) => {
    const hsl = rgbToHsl(b.rgb);
    const role = hsl.s > 0.35 && hsl.l > 0.15 && hsl.l < 0.85 && dominantRole(b) !== 'text' ? 'accent' : dominantRole(b);
    return { hex: b.hex, share: round2(b.weight / total), role };
  });
  return { palette, buckets: sorted };
}

export function extractTypography(snap: Snapshot): TypographyEntry[] {
  const fam = new Map<string, { sizes: Set<number>; weights: Set<number>; usage: number }>();
  for (const e of visible(snap)) {
    if (!e.ownText || e.words === 0 || !e.fontFamily) continue;
    const f = fam.get(e.fontFamily) ?? { sizes: new Set(), weights: new Set(), usage: 0 };
    f.sizes.add(Math.round(e.fontSize));
    f.weights.add(e.fontWeight);
    f.usage += e.words;
    fam.set(e.fontFamily, f);
  }
  const total = [...fam.values()].reduce((a, f) => a + f.usage, 0) || 1;
  return [...fam.entries()]
    .map(([family, f]) => ({
      family,
      sizes: [...f.sizes].sort((a, b) => a - b),
      weights: [...f.weights].sort((a, b) => a - b),
      usage: round2(f.usage / total),
    }))
    .sort((a, b) => b.usage - a.usage);
}

function contrastPairs(snap: Snapshot): ContrastPair[] {
  const pairs = new Map<string, ContrastPair & { weight: number }>();
  for (const e of visible(snap)) {
    if (!e.ownText || e.words === 0) continue;
    const c = elementContrast(e);
    if (!c) continue;
    const key = `${c.fg}|${c.bg}`;
    const existing = pairs.get(key);
    if (existing) existing.weight += e.words;
    else
      pairs.set(key, {
        foreground: c.fg,
        background: c.bg,
        ratio: c.ratio,
        passesAA: c.ratio >= c.required,
        sample: e.text.slice(0, 40),
        selector: e.selector,
        weight: e.words,
      });
  }
  return [...pairs.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12)
    .map(({ weight: _w, ...p }) => p);
}

function swatch(rgb: RGBA, role: string) {
  const on = bestTextOn(rgb);
  return { hex: toHex(rgb), role, onColor: toHex(on.color), contrast: round2(on.ratio) };
}

/** Garante que a cor de destaque funcione como fundo de botão com texto branco ou escuro (≥ 4.5:1). */
function accessibleAccent(rgb: RGBA): RGBA {
  const hsl = rgbToHsl(rgb);
  for (let step = 0; step <= 60; step++) {
    for (const dir of [-1, 1]) {
      const l = Math.min(0.9, Math.max(0.1, hsl.l + (dir * step) / 100));
      const c = hslToRgb({ ...hsl, l });
      if (bestTextOn(c).ratio >= 4.5) return c;
    }
  }
  return rgb;
}

export function suggestPalettes(buckets: Bucket[]): SuggestedPalette[] {
  const saturated = buckets.find((b) => {
    const hsl = rgbToHsl(b.rgb);
    return hsl.s > 0.3 && hsl.l > 0.12 && hsl.l < 0.88;
  });
  const brand = saturated?.rgb ?? { r: 79, g: 70, b: 229, a: 1 };
  const brandHsl = rgbToHsl(brand);
  const accent = accessibleAccent(brand);
  const neutral = (l: number, s = 0.08) => hslToRgb({ h: brandHsl.h, s: Math.min(brandHsl.s, s), l });
  const fromHue = (dh: number, l = 0.5) => accessibleAccent(hslToRgb({ h: brandHsl.h + dh, s: Math.max(0.45, brandHsl.s * 0.9), l }));
  const basis = saturated ? `a partir da cor de marca ${toHex(brand)}` : 'pois nenhuma cor de marca saturada foi detectada';

  return [
    {
      name: 'Refinada',
      rationale: `Mantém o matiz da marca ${basis}, ajusta a luminosidade para botões acessíveis e deriva neutros levemente tingidos.`,
      colors: [swatch(accent, 'Primária'), swatch(neutral(0.98, 0.04), 'Fundo'), swatch(neutral(0.94, 0.06), 'Superfície'), swatch(neutral(0.45), 'Texto secundário'), swatch(neutral(0.12), 'Texto')],
    },
    {
      name: 'Complementar',
      rationale: 'Adiciona um acento no matiz oposto (180°) para destacar ações secundárias e estados, sem competir com a primária.',
      colors: [swatch(accent, 'Primária'), swatch(fromHue(180), 'Acento'), swatch(neutral(0.97, 0.03), 'Fundo'), swatch(neutral(0.15), 'Texto')],
    },
    {
      name: 'Análoga',
      rationale: 'Usa matizes vizinhos (±30°) para gradientes e ilustrações coesos com a identidade atual.',
      colors: [swatch(fromHue(-30), 'Análoga A'), swatch(accent, 'Primária'), swatch(fromHue(30), 'Análoga B'), swatch(neutral(0.1), 'Fundo escuro')],
    },
  ];
}

export function analyzeIdentity(snap: Snapshot): { report: IdentityReport; issues: Issue[] } {
  const { palette, buckets } = extractPalette(snap);
  const typography = extractTypography(snap);
  const pairs = contrastPairs(snap);
  const issues: Issue[] = [];
  const vp = 'desktop' as const;

  // Cores quase iguais (ΔE 2.5–6): normalmente variações acidentais do mesmo token.
  const relevant = buckets.filter((b) => b.weight > 0).slice(0, 30);
  const near: { a: string; b: string; deltaE: number }[] = [];
  for (let i = 0; i < relevant.length; i++) {
    for (let j = i + 1; j < relevant.length; j++) {
      const d = deltaE2000(rgbToLab(relevant[i]!.rgb), rgbToLab(relevant[j]!.rgb));
      if (d >= 2.5 && d < 6) near.push({ a: relevant[i]!.hex, b: relevant[j]!.hex, deltaE: round2(d) });
    }
  }
  if (near.length >= 2) {
    issues.push(
      issue({
        ruleId: 'identity.near-duplicate-colors',
        category: 'identity',
        severity: near.length > 6 ? 'medium' : 'low',
        title: 'Variações acidentais de cor',
        description: `${plural(near.length, 'par de cores é', 'pares de cores são')} quase idênticos (ΔE2000 entre 2.5 e 6), como ${near[0]!.a} e ${near[0]!.b}. Isso indica valores digitados à mão em vez de tokens.`,
        recommendation: 'Consolide cada par no mesmo token de cor e documente a paleta em variáveis CSS.',
        evidence: near.slice(0, 10).map((n) => ({ viewport: vp, measured: { colorA: n.a, colorB: n.b, deltaE: n.deltaE } })),
        occurrences: near.length,
      }),
    );
  }

  // Muitas famílias de cor distintas (agrupando ΔE < 10).
  const families: RGBA[] = [];
  for (const b of relevant) {
    const hsl = rgbToHsl(b.rgb);
    if (hsl.s < 0.15) continue; // neutros não contam
    if (!families.some((f) => deltaE2000(rgbToLab(f), rgbToLab(b.rgb)) < 12)) families.push(b.rgb);
  }
  if (families.length > 6) {
    issues.push(
      issue({
        ruleId: 'identity.color-sprawl',
        category: 'identity',
        severity: families.length > 9 ? 'medium' : 'low',
        title: 'Paleta cromática dispersa',
        description: `Foram identificadas ${families.length} famílias de cores saturadas diferentes. A identidade perde foco e as cores deixam de comunicar significado.`,
        recommendation: 'Restrinja a paleta a 1 cor primária, 1 acento e cores de estado (sucesso, alerta, erro), com neutros para o restante.',
        evidence: [{ viewport: vp, measured: { families: families.length, colors: families.map((f) => toHex(f)).join(', ') } }],
        occurrences: families.length,
      }),
    );
  }

  if (typography.length > 3) {
    issues.push(
      issue({
        ruleId: 'identity.font-families',
        category: 'identity',
        severity: typography.length > 4 ? 'medium' : 'low',
        title: 'Famílias tipográficas demais',
        description: `A página usa ${typography.length} famílias de fonte: ${typography.map((t) => t.family).join(', ')}.`,
        recommendation: 'Use no máximo duas famílias (títulos e texto) e varie peso e tamanho para criar hierarquia.',
        evidence: [{ viewport: vp, measured: { families: typography.map((t) => `${t.family} (${Math.round(t.usage * 100)}%)`).join(', ') } }],
        occurrences: typography.length,
      }),
    );
  }

  const typeScale = [...new Set(typography.flatMap((t) => t.sizes))].sort((a, b) => a - b);

  return {
    report: {
      palette,
      typography,
      contrastPairs: pairs,
      suggestions: suggestPalettes(buckets),
      nearDuplicateColors: near.slice(0, 12),
      typeScale,
    },
    issues,
  };
}

export function emptyIdentity(): IdentityReport {
  return { palette: [], typography: [], contrastPairs: [], suggestions: [], nearDuplicateColors: [], typeScale: [] };
}

/** Identidade visual a partir de pixels de uma imagem importada (sem DOM). */
export function identityFromPixels(colors: { r: number; g: number; b: number; count: number }[]): IdentityReport {
  const buckets: Bucket[] = [];
  for (const c of colors) {
    const rgb = { r: c.r, g: c.g, b: c.b, a: 1 };
    const lab = rgbToLab(rgb);
    const existing = buckets.find((b) => deltaE2000(rgbToLab(b.rgb), lab) < 5);
    if (existing) existing.weight += c.count;
    else buckets.push({ rgb, hex: toHex(rgb), weight: c.count, roles: new Map([['background', c.count]]) });
  }
  buckets.sort((a, b) => b.weight - a.weight);
  const total = buckets.reduce((a, b) => a + b.weight, 0) || 1;
  const palette: PaletteColor[] = buckets.slice(0, 10).map((b, idx) => {
    const hsl = rgbToHsl(b.rgb);
    const role: PaletteColor['role'] = idx === 0 ? 'background' : hsl.s > 0.35 && hsl.l > 0.15 && hsl.l < 0.85 ? 'accent' : hsl.l < 0.3 ? 'text' : 'background';
    return { hex: b.hex, share: round2(b.weight / total), role };
  });
  return {
    palette,
    typography: [],
    contrastPairs: [],
    suggestions: suggestPalettes(buckets),
    nearDuplicateColors: [],
    typeScale: [],
  };
}
