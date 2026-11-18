import { describe, expect, it } from 'vitest';
import { validateFindings, type AiFinding } from '../src/ai/claude.js';
import { contrastRatio, deltaE2000, fixContrast, parseColor, rgbToLab, toHex } from '../src/analysis/color.js';
import { computeScores, recurrenceFactor } from '../src/analysis/scoring.js';
import type { Snapshot, SnapEl } from '../src/capture/snapshot.js';
import type { Issue } from '../src/domain/types.js';
import { sanitizeCss, safeSelector } from '../src/redesign/cssSanitizer.js';
import { buildDeterministicFixes } from '../src/redesign/fixes.js';

describe('cor', () => {
  it('interpreta formatos e calcula contraste WCAG', () => {
    const white = parseColor('#fff')!;
    const black = parseColor('rgb(0, 0, 0)')!;
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
    expect(contrastRatio(parseColor('#777777')!, white)).toBeCloseTo(4.48, 1);
    expect(parseColor('rgba(10, 20, 30, 0.5)')!.a).toBe(0.5);
    expect(parseColor('nada')).toBeNull();
  });

  it('corrige contraste mantendo o matiz', () => {
    const fg = parseColor('#60a5fa')!;
    const bg = parseColor('#ffffff')!;
    const fixed = fixContrast(fg, bg, 4.5)!;
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(4.5);
    // Continua azul: componente B dominante.
    expect(fixed.b).toBeGreaterThan(fixed.r);
    expect(toHex(fixed)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('ΔE2000 confere com valores de referência', () => {
    // Par de referência de Sharma et al. (2005): ΔE ≈ 2.0425
    const d = deltaE2000({ l: 50, a: 2.6772, b: -79.7751 }, { l: 50, a: 0, b: -82.7485 });
    expect(d).toBeCloseTo(2.0425, 3);
    expect(deltaE2000(rgbToLab(parseColor('#3b82f6')!), rgbToLab(parseColor('#3b82f6')!))).toBe(0);
  });
});

describe('pontuação', () => {
  const mk = (severity: Issue['severity'], category: Issue['category'], occurrences = 1): Issue => ({
    id: `${severity}-${category}-${occurrences}`,
    ruleId: 'x',
    source: 'rules',
    category,
    severity,
    title: '',
    description: '',
    recommendation: '',
    evidence: [],
    occurrences,
    fixable: false,
  });

  it('parte de 100 e penaliza por severidade e recorrência', () => {
    expect(computeScores([]).overall).toBe(100);
    const s = computeScores([mk('high', 'accessibility', 4)]);
    expect(s.categories.accessibility).toBe(100 - Math.round(14 * recurrenceFactor(4)));
    expect(s.ui).toBe(100);
    expect(s.ux).toBeLessThan(100);
  });

  it('nunca fica negativa e ignora problemas descartados', () => {
    const many = Array.from({ length: 20 }, () => mk('critical', 'visual', 50));
    expect(computeScores(many).categories.visual).toBe(0);
    const dismissed = { ...mk('critical', 'ux'), status: 'dismissed' as const };
    expect(computeScores([dismissed]).overall).toBe(100);
  });
});

describe('sanitizador de CSS', () => {
  it('remove construções que geram rede ou execução', () => {
    const r = sanitizeCss(`body { color: red; }\n.a { background: url(http://169.254.169.254/x); }\n@import "http://evil";\n.b { width: expression(alert(1)); }`);
    expect(r.css).toContain('color: red');
    expect(r.css).not.toMatch(/url\(|@import|expression/i);
    expect(r.removed).toBeGreaterThan(0);
  });

  it('não é enganado por comentários e escapes', () => {
    const r = sanitizeCss('.a { background: u/**/rl(http://x) }\n.b { background: \\75 rl(http://x) }');
    expect(r.css).not.toMatch(/url\(/i);
    expect(r.css).not.toMatch(/http:\/\/x/);
  });

  it('valida seletores', () => {
    expect(safeSelector('body > div:nth-of-type(2)')).toBe(true);
    expect(safeSelector('a{}')).toBe(false);
    expect(safeSelector('</style><script>')).toBe(false);
  });
});

const baseEl = (over: Partial<SnapEl>): SnapEl => ({
  i: 0, parent: -1, depth: 0, tag: 'p', kind: 'text', selector: 'body > p:nth-of-type(1)', role: null,
  x: 10, y: 10, w: 200, h: 40, text: 'Olá', ownText: true, words: 3, color: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)',
  ownBg: 'rgba(0, 0, 0, 0)', bgImage: false, fontSize: 16, fontWeight: 400, fontFamily: 'Inter', lineHeight: 24,
  display: 'block', position: 'static', margin: [0, 0, 0, 0], padding: [0, 0, 0, 0], radius: 0, borderWidth: 0,
  borderColor: 'rgb(0, 0, 0)', textAlign: 'left', interactive: false, name: '', headingLevel: null, imgAlt: null,
  imgNaturalW: 0, imgNaturalH: 0, imgVector: false, objectFit: 'fill', inputType: null, hasLabel: true, placeholder: null,
  autocomplete: null, required: false, overflowRight: 0, clippedByAncestor: false, textCut: false, hidden: false,
  focusOutlineNone: false, ...over,
});

const snap = (elements: SnapEl[]): Snapshot => ({
  viewport: { width: 1440, height: 900 }, url: 'https://x.com', title: 'x', lang: 'pt-BR',
  metaViewport: 'width=device-width', docWidth: 1440, docHeight: 2000, clientWidth: 1440, elements,
  truncated: false, forms: [], landmarks: { nav: 1, main: 1, header: 1, footer: 1 }, navLinksVisible: 3,
  navToggle: false, navOverflow: false, duplicateIds: [], skipLink: true, pageBg: 'rgb(255, 255, 255)',
});

describe('validação de achados da IA', () => {
  const images = [{ viewport: 'desktop' as const, file: 'd.jpg', width: 1440, height: 1800, mediaType: 'image/jpeg' as const }];
  const snapshots = { desktop: snap([baseEl({ selector: 'main > h1', x: 20, y: 30, w: 400, h: 60, text: 'Título' })]) };
  const finding = (over: Partial<AiFinding>): AiFinding => ({
    category: 'visual', severity: 'medium', title: 't', description: 'd', recommendation: 'r', viewport: 'desktop',
    selector: null, region: null, observation: 'observado', ...over,
  });

  it('aceita seletor real e usa o retângulo medido (não o da IA)', () => {
    const { issues, rejected } = validateFindings([finding({ selector: 'main > h1', region: { x: 0, y: 0, width: 5000, height: 5000 } })], { images, snapshots });
    expect(rejected).toBe(0);
    expect(issues[0]!.evidence[0]!.rect).toEqual({ x: 20, y: 30, width: 400, height: 60 });
    expect(issues[0]!.source).toBe('ai');
  });

  it('descarta seletores inventados, regiões fora da imagem e achados sem observação', () => {
    const { issues, rejected } = validateFindings(
      [
        finding({ selector: '.nao-existe' }),
        finding({ region: { x: 1300, y: 10, width: 400, height: 50 } }),
        finding({ region: { x: 10, y: 10, width: 100, height: 50 }, observation: '  ' }),
        finding({ viewport: 'mobile', region: { x: 10, y: 10, width: 100, height: 50 } }),
        finding({ region: { x: 10, y: 10, width: 100, height: 50 } }),
      ],
      { images, snapshots },
    );
    expect(rejected).toBe(4);
    expect(issues).toHaveLength(1);
  });
});

describe('correções determinísticas', () => {
  it('gera CSS com seletores reais e lista de mudanças rastreável', () => {
    const issue: Issue = {
      id: 'a11y.contrast', ruleId: 'a11y.contrast', source: 'rules', category: 'accessibility', severity: 'high',
      title: '', description: '', recommendation: '', occurrences: 1, fixable: true,
      evidence: [{ viewport: 'desktop', selector: 'body > p:nth-of-type(1)', snippet: 'Olá', measured: { ratio: 2.1, required: 4.5, foreground: '#aaaaaa', suggestedColor: '#767676' } }],
    };
    const touch: Issue = {
      ...issue, id: 'ux.touch-target', ruleId: 'ux.touch-target', category: 'ux',
      evidence: [{ viewport: 'mobile', selector: 'nav > a:nth-of-type(1)', measured: { size: '30×16' } }],
    };
    const { css, changes } = buildDeterministicFixes([issue, touch], { desktop: snap([]), mobile: snap([]) });
    expect(css).toContain('body > p:nth-of-type(1) { color: #767676 !important; }');
    expect(css).toMatch(/@media \(max-width: 900px\) \{[\s\S]*nav > a:nth-of-type\(1\)[\s\S]*min-height: 44px/);
    expect(changes.map((c) => c.issueId)).toEqual(['a11y.contrast', 'ux.touch-target']);
    expect(sanitizeCss(css).removed).toBe(0);
  });
});

describe('contraste em elementos com fundo próprio', () => {
  it('preserva o texto branco do botão e escurece o fundo mantendo o matiz', async () => {
    const { elementContrast } = await import('../src/analysis/rules/accessibility.js');
    const button = baseEl({ kind: 'button', tag: 'button', color: 'rgb(255, 255, 255)', bg: 'rgb(201, 130, 74)', ownBg: 'rgb(201, 130, 74)', padding: [6, 10, 6, 10], fontSize: 12 });
    const c = elementContrast(button)!;
    expect(c.ratio).toBeLessThan(4.5);
    expect(c.suggested).toBeNull();
    const bg = parseColor(c.suggestedBackground)!;
    expect(contrastRatio(parseColor('#ffffff')!, bg)).toBeGreaterThanOrEqual(4.5);
    expect(bg.r).toBeGreaterThan(bg.b); // continua laranja/marrom

    const { css, changes } = buildDeterministicFixes(
      [{ id: 'c', ruleId: 'a11y.contrast', source: 'rules', category: 'accessibility', severity: 'high', title: '', description: '', recommendation: '', occurrences: 1, fixable: true,
        evidence: [{ viewport: 'desktop', selector: 'button', snippet: 'Comprar', measured: { ratio: c.ratio, required: 4.5, foreground: '#ffffff', background: c.bg, suggestedBackground: c.suggestedBackground! } }] }],
      {},
    );
    expect(css).toContain(`button { background-color: ${c.suggestedBackground} !important; }`);
    expect(changes[0]!.detail).toMatch(/mantendo o texto #ffffff/);
  });
});
