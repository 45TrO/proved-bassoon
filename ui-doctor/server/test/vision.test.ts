import { describe, expect, it } from 'vitest';
import type { Snapshot, SnapEl } from '../src/capture/snapshot.js';
import type { Issue } from '../src/domain/types.js';
import { buildHarmonization } from '../src/redesign/harmonize.js';
import { parseDom } from '../src/vision/domParser.js';
import type { Candidate, Facts, ImageFacts } from '../src/vision/facts.js';
import { domTextFor, monitor } from '../src/vision/monitor.js';
import { detectNavItems, findComponentVariants } from '../src/vision/patterns.js';
import { estimateFontSize, hasAscenders } from '../src/vision/rules.js';
import type { OcrLine } from '../src/vision/ocr.js';

const el = (over: Partial<SnapEl>): SnapEl => ({
  i: 0, parent: -1, depth: 0, tag: 'p', kind: 'text', selector: 'p', role: null, x: 0, y: 0, w: 100, h: 20, text: 'Olá',
  ownText: true, words: 3, color: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)', ownBg: 'rgba(0, 0, 0, 0)', bgImage: false,
  fontSize: 16, fontWeight: 400, fontFamily: 'Inter', lineHeight: 24, display: 'block', position: 'static',
  margin: [0, 0, 0, 0], padding: [0, 0, 0, 0], radius: 0, borderWidth: 0, borderColor: 'rgb(0, 0, 0)', textAlign: 'left',
  interactive: false, name: '', headingLevel: null, imgAlt: null, imgNaturalW: 0, imgNaturalH: 0, imgVector: false,
  objectFit: 'fill', inputType: null, hasLabel: true, placeholder: null, autocomplete: null, required: false,
  overflowRight: 0, clippedByAncestor: false, textCut: false, hidden: false, focusOutlineNone: false, ...over,
});

const snap = (elements: SnapEl[]): Snapshot => ({
  viewport: { width: 1440, height: 900 }, url: 'x', title: 'x', lang: 'pt-BR', metaViewport: 'width=device-width', docWidth: 1440,
  docHeight: 2000, clientWidth: 1440, elements, truncated: false, forms: [], landmarks: { nav: 1, main: 1, header: 1, footer: 1 },
  navLinksVisible: 3, navToggle: false, navOverflow: false, duplicateIds: [], skipLink: true, pageBg: 'rgb(255, 255, 255)',
});

const image = { viewport: 'desktop', width: 1440, height: 1800 } as unknown as ImageFacts;

const facts = (over: Partial<Facts> = {}): Facts => ({ source: 'url', images: [image], snapshots: {}, dom: null, variants: [], ruleIssues: [], ...over });

const candidate = (over: Partial<Candidate>): Candidate => ({
  rule: 'vision.x', category: 'visual', severity: 'medium', title: 't', description: 'd', recommendation: 'r',
  evidence: [{ viewport: 'desktop', rect: { x: 10, y: 10, width: 100, height: 20 }, measured: { a: 1 } }], confidence: 0.9, modules: ['Imagem'], ...over,
});

describe('monitor baseado em regras', () => {
  it('aceita achado com evidência válida e alta confiança', () => {
    const out = monitor([candidate({})], facts());
    expect(out.accepted).toHaveLength(1);
    expect(out.accepted[0]!.source).toBe('vision');
    expect(out.trace[0]!.outcome).toBe('accepted');
  });

  it('rejeita evidência fora da captura e confiança baixa', () => {
    const out = monitor(
      [candidate({ evidence: [{ viewport: 'desktop', rect: { x: 1400, y: 10, width: 200, height: 20 }, measured: {} }] }), candidate({ confidence: 0.4 })],
      facts(),
    );
    expect(out.accepted).toHaveLength(0);
    expect(out.counts.rejected).toBe(2);
    expect(out.trace.map((t) => t.reason).join(' ')).toMatch(/fora da área capturada|mínimo de 60%/);
  });

  it('rebaixa a severidade quando a confiança é moderada', () => {
    const out = monitor([candidate({ confidence: 0.7, severity: 'high' })], facts());
    expect(out.accepted[0]!.severity).toBe('medium');
    expect(out.counts.downgraded).toBe(1);
  });

  it('contraste por pixels: o DOM aprova → rejeita; o DOM reprova → corrobora o problema existente', () => {
    const good = el({ selector: 'p.ok', x: 0, y: 0, w: 1200, h: 30, color: 'rgb(20, 20, 20)' });
    const bad = el({ selector: 'p.bad', x: 0, y: 100, w: 1200, h: 30, color: 'rgb(181, 181, 181)' });
    const domIssue: Issue = { id: 'a11y.contrast', ruleId: 'a11y.contrast', source: 'rules', category: 'accessibility', severity: 'high', title: 'c', description: '', recommendation: '', evidence: [{ viewport: 'desktop', selector: 'p.bad', measured: {} }], occurrences: 1, fixable: true };
    const pixel = candidate({
      rule: 'vision.ocr-contrast',
      category: 'accessibility',
      evidence: [
        { viewport: 'desktop', rect: { x: 0, y: 4, width: 500, height: 18 }, snippet: 'ok', measured: { ratio: 4.2 } },
        { viewport: 'desktop', rect: { x: 0, y: 104, width: 500, height: 18 }, snippet: 'ruim', measured: { ratio: 2.1 } },
      ],
    });
    const out = monitor([pixel], facts({ snapshots: { desktop: snap([good, bad]) }, ruleIssues: [domIssue] }));
    expect(out.accepted).toHaveLength(0);
    expect(out.counts.rejected).toBe(1);
    expect(out.counts.corroborated).toBe(1);
    expect(domIssue.corroboration).toEqual(['OCR', 'Imagem']);
  });

  it('não duplica um problema já medido no DOM na mesma região', () => {
    const domIssue: Issue = { id: 'visual.density', ruleId: 'visual.density', source: 'rules', category: 'visual', severity: 'low', title: 'densa', description: '', recommendation: '', evidence: [{ viewport: 'desktop', rect: { x: 0, y: 0, width: 1440, height: 900 }, measured: {} }], occurrences: 1, fixable: false };
    const out = monitor([candidate({ evidence: [{ viewport: 'desktop', rect: { x: 0, y: 0, width: 1440, height: 900 }, measured: {} }] })], facts({ ruleIssues: [domIssue] }));
    expect(out.accepted).toHaveLength(0);
    expect(domIssue.corroboration).toEqual(['Imagem']);
  });

  it('casa linhas do OCR com o DOM nas duas direções', () => {
    const paragraph = el({ selector: 'p', x: 0, y: 0, w: 1376, h: 40 });
    const links = [el({ selector: 'a1', x: 10, y: 200, w: 40, h: 16 }), el({ selector: 'a2', x: 60, y: 200, w: 40, h: 16 })];
    expect(domTextFor([paragraph], { x: 0, y: 5, width: 600, height: 18 }).map((e) => e.selector)).toEqual(['p']);
    expect(domTextFor(links, { x: 8, y: 198, width: 100, height: 20 }).map((e) => e.selector)).toEqual(['a1', 'a2']);
  });
});

describe('reconhecimento de padrões', () => {
  it('separa a logomarca dos itens do menu pelo vão', () => {
    const word = (text: string, x: number, w = 40) => ({ text, confidence: 95, box: { x, y: 20, width: w, height: 14 } });
    const words = [word('Café', 40, 40), word('Aurora', 86, 60), word('Cafés', 1000), word('Métodos', 1056), word('Cursos', 1112), word('Blog', 1168)];
    const line: OcrLine = { text: '', confidence: 95, box: { x: 40, y: 20, width: 1200, height: 14 }, words };
    const nav = detectNavItems([line], 120);
    expect(nav.items).toEqual(['Cafés', 'Métodos', 'Cursos', 'Blog']);
  });

  it('aponta variante acidental de botão e ignora variantes intencionais', () => {
    const btn = (selector: string, radius: number, h: number, bg = 'rgb(37, 99, 235)') => el({ kind: 'button', tag: 'button', selector, radius, h, ownBg: bg, text: 'Ok' });
    const { variants } = findComponentVariants([btn('a', 6, 40), btn('b', 6, 40), btn('c', 6, 40), btn('d', 7, 41), btn('e', 20, 56, 'rgb(220, 20, 60)')]);
    expect(variants.map((v) => v.outlier.selector)).toEqual(['d']);
    expect(variants[0]!.differences.join(' ')).toMatch(/raio 7px em vez de 6px/);
  });

  it('estima o tamanho da fonte pelas formas das letras', () => {
    expect(hasAscenders('para a sua casa')).toBe(false);
    expect(hasAscenders('Comprar')).toBe(true);
    expect(estimateFontSize('Texto legível', 15)).toBeCloseTo(15.8, 0);
    expect(estimateFontSize('cama nova', 8)).toBeCloseTo(15.4, 0);
  });
});

describe('parsing de DOM', () => {
  it('extrai fatos estáticos do HTML', () => {
    const d = parseDom(`<!doctype html><html><head><title>Loja</title></head><body>
      <center><font>antigo</font></center>
      <a href="/x"></a><a href="/y" target="_blank">nova aba</a>
      <div onclick="go()">clique</div><input tabindex="3">
      <iframe src="/m"></iframe><video autoplay src="v.mp4"></video>
      <img src="a.png"><table><tr><td>layout</td></tr></table><h2></h2>
    </body></html>`);
    expect(d.title).toBe('Loja');
    expect(d.metaDescription).toBeNull();
    expect(d.deprecatedTags).toEqual({ center: 1, font: 1 });
    expect(d.emptyLinks).toBe(1);
    expect(d.blankTargetsWithoutRel).toBe(1);
    expect(d.clickableDivs).toBe(1);
    expect(d.positiveTabindex).toHaveLength(1);
    expect(d.iframesWithoutTitle).toBe(1);
    expect(d.autoplayMedia).toBe(1);
    expect(d.imagesWithoutDimensions).toBe(1);
    expect(d.layoutTables).toBe(1);
    expect(d.emptyHeadings).toBe(1);
  });
});

describe('harmonização por regras', () => {
  it('unifica variantes, cores quase iguais e famílias excedentes', () => {
    const btn = (selector: string, radius: number, bg: string) => el({ kind: 'button', tag: 'button', selector, radius, h: 40, ownBg: bg, text: 'Ok', ownText: true });
    const els = [
      btn('b1', 6, 'rgb(37, 99, 235)'),
      btn('b2', 6, 'rgb(37, 99, 235)'),
      btn('b3', 6, 'rgb(37, 99, 235)'),
      btn('b4', 8, 'rgb(37, 99, 235)'),
      el({ selector: 'p1', color: 'rgb(200, 30, 30)', words: 10 }),
      el({ selector: 'p2', color: 'rgb(200, 30, 30)', words: 10 }),
      el({ selector: 'p3', color: 'rgb(203, 32, 31)', words: 2 }),
      el({ selector: 'h', fontFamily: 'Georgia', words: 20 }),
      el({ selector: 'x', fontFamily: 'Courier New', words: 2 }),
      el({ selector: 'y', fontFamily: 'Verdana', words: 1 }),
    ];
    const { css, changes } = buildHarmonization({ desktop: snap(els) });
    expect(css).toContain('b4 { border-radius: 6px');
    expect(css).toContain('p3 { color: #c81e1e');
    expect(changes.map((c) => c.title)).toEqual(expect.arrayContaining(['Componente unificado', 'Cor unificada', 'Tipografia consolidada']));
    expect(css).toContain('y { font-family: "Inter"');
  });
});
