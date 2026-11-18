/**
 * Código executado DENTRO da página analisada (via page.evaluate).
 * Mantido como string JS pura para não depender de helpers do bundler.
 * Retorna um objeto `Snapshot` (ver snapshot.ts).
 */
export const COLLECTOR_SOURCE = String.raw`(() => {
  const MAX_ELEMENTS = 2500;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const doc = document.documentElement;
  const sx = window.scrollX, sy = window.scrollY;
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','META','LINK','HEAD','TITLE','BR','WBR','SOURCE','TRACK','PATH','G','DEFS','USE','CIRCLE','RECT','LINE','POLYLINE','POLYGON','ELLIPSE','STOP','LINEARGRADIENT','RADIALGRADIENT','CLIPPATH','MASK','SYMBOL','TSPAN','TEXT']);
  const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');

  const idCounts = {};
  for (const el of document.querySelectorAll('[id]')) { idCounts[el.id] = (idCounts[el.id] || 0) + 1; }
  const duplicateIds = Object.keys(idCounts).filter((k) => k && idCounts[k] > 1).slice(0, 20);

  const selectorCache = new Map();
  function selectorFor(el) {
    if (selectorCache.has(el)) return selectorCache.get(el);
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 8) {
      if (node.id && idCounts[node.id] === 1 && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift('#' + esc(node.id));
        break;
      }
      const tag = node.tagName.toLowerCase();
      if (tag === 'html') { parts.unshift('html'); break; }
      if (tag === 'body') { parts.unshift('body'); break; }
      let idx = 1;
      let sib = node.previousElementSibling;
      while (sib) { if (sib.tagName === node.tagName) idx++; sib = sib.previousElementSibling; }
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      node = node.parentElement;
      depth++;
    }
    const sel = parts.join(' > ');
    selectorCache.set(el, sel);
    return sel;
  }

  // Normaliza qualquer cor CSS (oklch, color(), hsl, nomes...) para rgba sRGB via canvas.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const normCache = new Map();
  function norm(c) {
    if (!c) return 'rgba(0, 0, 0, 0)';
    if (/^rgba?\(/.test(c)) return c;
    if (normCache.has(c)) return normCache.get(c);
    let out = c;
    if (cx) {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = 'rgba(0,0,0,0)';
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      out = 'rgba(' + d[0] + ', ' + d[1] + ', ' + d[2] + ', ' + Math.round((d[3] / 255) * 100) / 100 + ')';
    }
    normCache.set(c, out);
    return out;
  }

  function parseRgba(s) {
    const m = /rgba?\(([^)]+)\)/.exec(norm(s || ''));
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function compose(top, bottom) {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
      g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
      b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
      a,
    };
  }
  const rgbStr = (c) => 'rgb(' + Math.round(c.r) + ', ' + Math.round(c.g) + ', ' + Math.round(c.b) + ')';

  const bgCache = new Map();
  function effectiveBg(el) {
    if (bgCache.has(el)) return bgCache.get(el);
    const layers = [];
    let node = el;
    let image = false;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      const c = parseRgba(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') { image = true; break; }
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      node = node.parentElement;
    }
    let color = { r: 255, g: 255, b: 255, a: 1 };
    for (let k = layers.length - 1; k >= 0; k--) color = compose(layers[k], color);
    const out = { color: rgbStr(color), image };
    bgCache.set(el, out);
    return out;
  }

  function textOf(el) {
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    return own.replace(/\s+/g, ' ').trim();
  }

  function accessibleName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? n.textContent : ''; }).join(' ').trim();
      if (t) return t;
    }
    if (el.tagName === 'IMG') return (el.getAttribute('alt') || '').trim();
    if (el.tagName === 'INPUT') {
      const t = (el.type || '').toLowerCase();
      if (['submit','button','reset'].includes(t)) return (el.value || '').trim();
      if (t === 'image') return (el.getAttribute('alt') || '').trim();
      if (el.labels && el.labels.length) return Array.from(el.labels).map((l) => l.textContent).join(' ').trim();
    }
    if ((el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') && el.labels && el.labels.length) {
      return Array.from(el.labels).map((l) => l.textContent).join(' ').trim();
    }
    const inner = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (inner) return inner.slice(0, 120);
    const img = el.querySelector && el.querySelector('img[alt]');
    if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim();
    const svgTitle = el.querySelector && el.querySelector('svg title');
    if (svgTitle && svgTitle.textContent.trim()) return svgTitle.textContent.trim();
    const title = el.getAttribute('title');
    return title ? title.trim() : '';
  }

  function kindOf(el, cs) {
    const tag = el.tagName;
    const role = el.getAttribute('role');
    if (tag === 'BUTTON' || role === 'button' || (tag === 'INPUT' && ['submit','button','reset','image'].includes((el.type || '').toLowerCase()))) return 'button';
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (role === 'link') return 'link';
    if (tag === 'INPUT') return 'input';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'IMG' || (tag === 'svg' && el.getAttribute('role') === 'img')) return 'img';
    if (tag === 'VIDEO' || tag === 'CANVAS' || tag === 'IFRAME' || tag === 'PICTURE') return 'media';
    if (/^H[1-6]$/.test(tag) || role === 'heading') return 'heading';
    if (textOf(el)) return 'text';
    if (['DIV','SECTION','ARTICLE','MAIN','HEADER','FOOTER','NAV','ASIDE','UL','OL','FORM','FIELDSET'].includes(tag)) return 'container';
    return 'other';
  }

  function clippedByAncestor(el, rect) {
    let node = el.parentElement;
    while (node && node !== document.body && node !== doc) {
      const cs = getComputedStyle(node);
      // hidden/clip/auto/scroll: o conteúdo fica contido (ou rola) dentro do ancestral.
      if (cs.overflowX !== 'visible') {
        const r = node.getBoundingClientRect();
        if (r.right <= doc.clientWidth + 1) return true;
      }
      if (cs.position === 'fixed') return false;
      node = node.parentElement;
    }
    return false;
  }

  const elements = [];
  const indexOf = new Map();
  let truncated = false;
  const walker = document.createTreeWalker(document.body || doc, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  while (node) {
    const el = node;
    node = walker.nextNode();
    if (SKIP.has(el.tagName.toUpperCase()) && el.tagName !== 'svg') continue;
    if (el.closest && el.closest('svg') && el.tagName !== 'svg') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
    if (parseFloat(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const srOnly = rect.width <= 1 || rect.height <= 1 || (cs.position === 'absolute' && cs.clip && cs.clip !== 'auto');
    if (elements.length >= MAX_ELEMENTS) { truncated = true; break; }

    let parent = -1;
    let p = el.parentElement;
    while (p) { if (indexOf.has(p)) { parent = indexOf.get(p); break; } p = p.parentElement; }

    const kind = kindOf(el, cs);
    const own = textOf(el);
    const interactive = ['button','link','input','select','textarea'].includes(kind) || el.hasAttribute('onclick') || (el.tabIndex >= 0 && el.hasAttribute('tabindex'));
    const bg = effectiveBg(el);
    const right = rect.right;
    const overflowRight = Math.max(0, Math.round(right - doc.clientWidth));
    const hl = /^H([1-6])$/.exec(el.tagName);
    const ariaLevel = el.getAttribute('aria-level');
    const isField = kind === 'input' || kind === 'select' || kind === 'textarea';
    const inputType = kind === 'input' ? (el.type || 'text').toLowerCase() : null;
    const hasLabel = isField ? Boolean((el.labels && el.labels.length) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) : true;
    const textCut = Boolean(own) && el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis';
    const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);

    const entry = {
      i: elements.length,
      parent,
      depth: parent === -1 ? 0 : elements[parent].depth + 1,
      tag: el.tagName.toLowerCase(),
      kind,
      selector: selectorFor(el),
      role: el.getAttribute('role'),
      x: Math.round(rect.left + sx), y: Math.round(rect.top + sy), w: Math.round(rect.width), h: Math.round(rect.height),
      text: (own || (kind === 'button' || kind === 'link' || kind === 'heading' ? accessibleName(el) : '')).slice(0, 140),
      ownText: Boolean(own),
      words: own ? own.split(/\s+/).length : 0,
      color: norm(cs.color),
      bg: bg.color,
      ownBg: norm(cs.backgroundColor),
      bgImage: bg.image,
      fontSize: parseFloat(cs.fontSize) || 0,
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      fontFamily: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
      lineHeight: Math.round(lh * 10) / 10,
      display: cs.display,
      position: cs.position,
      margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map((v) => Math.round(parseFloat(v) || 0)),
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => Math.round(parseFloat(v) || 0)),
      radius: Math.round(parseFloat(cs.borderTopLeftRadius) || 0),
      borderWidth: Math.round(parseFloat(cs.borderTopWidth) || 0),
      borderColor: norm(cs.borderTopColor),
      textAlign: cs.textAlign,
      interactive,
      name: interactive || kind === 'img' ? accessibleName(el).slice(0, 120) : '',
      headingLevel: hl ? Number(hl[1]) : (ariaLevel && el.getAttribute('role') === 'heading' ? Number(ariaLevel) : null),
      imgAlt: el.tagName === 'IMG' ? el.getAttribute('alt') : null,
      imgNaturalW: el.tagName === 'IMG' ? el.naturalWidth : 0,
      imgNaturalH: el.tagName === 'IMG' ? el.naturalHeight : 0,
      objectFit: cs.objectFit,
      inputType,
      hasLabel,
      placeholder: isField ? el.getAttribute('placeholder') : null,
      autocomplete: isField ? el.getAttribute('autocomplete') : null,
      required: isField ? Boolean(el.required || el.getAttribute('aria-required') === 'true') : false,
      overflowRight,
      clippedByAncestor: overflowRight > 0 ? clippedByAncestor(el, rect) : false,
      textCut,
      hidden: srOnly,
      focusOutlineNone: false,
    };
    indexOf.set(el, entry.i);
    elements.push(entry);
  }

  const forms = Array.from(document.querySelectorAll('form')).slice(0, 30).map((f) => {
    const r = f.getBoundingClientRect();
    const fields = Array.from(f.querySelectorAll('input, select, textarea')).filter((x) => {
      const t = (x.type || '').toLowerCase();
      if (['hidden','submit','button','reset','image'].includes(t)) return false;
      const cs = getComputedStyle(x);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    });
    const unlabeled = fields.filter((x) => !((x.labels && x.labels.length) || x.getAttribute('aria-label') || x.getAttribute('aria-labelledby') || x.getAttribute('title'))).length;
    return {
      selector: selectorFor(f),
      x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height),
      fields: fields.length,
      required: fields.filter((x) => x.required || x.getAttribute('aria-required') === 'true').length,
      unlabeled,
      hasSubmit: Boolean(f.querySelector('button:not([type=button]):not([type=reset]), input[type=submit], input[type=image]')),
    };
  }).filter((f) => f.w > 0 && f.h > 0);

  const navs = Array.from(document.querySelectorAll('nav, [role=navigation]'));
  let navLinksVisible = 0;
  let navOverflow = false;
  for (const n of navs) {
    for (const a of n.querySelectorAll('a[href], button')) {
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && r.top < vh) {
        navLinksVisible++;
        if (r.right > doc.clientWidth + 1) navOverflow = true;
      }
    }
  }
  const header = document.querySelector('header, [role=banner]') || navs[0];
  const toggleCandidates = Array.from(document.querySelectorAll('button[aria-expanded], [aria-controls], button[aria-label*="menu" i], button[class*="menu" i], button[class*="burger" i], [class*="hamburger" i], details > summary'));
  const navToggle = toggleCandidates.some((b) => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.top < vh;
  });

  const skipLink = Array.from(document.querySelectorAll('a[href^="#"]')).slice(0, 5).some((a) => /pular|skip|ir para o conte|saltar/i.test(a.textContent || ''));
  const metaVp = document.querySelector('meta[name="viewport"]');

  return {
    viewport: { width: vw, height: vh },
    url: location.href,
    title: document.title || '',
    lang: doc.getAttribute('lang'),
    metaViewport: metaVp ? metaVp.getAttribute('content') : null,
    docWidth: Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0),
    docHeight: Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0),
    clientWidth: doc.clientWidth,
    elements,
    truncated,
    forms,
    landmarks: {
      nav: navs.length,
      main: document.querySelectorAll('main, [role=main]').length,
      header: document.querySelectorAll('header, [role=banner]').length,
      footer: document.querySelectorAll('footer, [role=contentinfo]').length,
    },
    navLinksVisible,
    navToggle: Boolean(header) && navToggle,
    navOverflow,
    duplicateIds,
    skipLink,
    pageBg: effectiveBg(document.body || doc).color,
  };
})()`;
