/** Utilitários de cor: parsing, contraste WCAG 2.x, CIELAB e ΔE2000. */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (v: number, min = 0, max = 255) => Math.min(max, Math.max(min, v));

export function parseColor(input: string | null | undefined): RGBA | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1]!;
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = h.split('').map((c) => parseInt(c + c, 16));
      return { r: r!, g: g!, b: b!, a: a === undefined ? 1 : a / 255 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: clamp(+m[1]!), g: clamp(+m[2]!), b: clamp(+m[3]!), a: clamp(a, 0, 1) };
  }
  return null;
}

export function toHex({ r, g, b }: RGBA): string {
  return `#${[r, g, b].map((v) => Math.round(clamp(v)).toString(16).padStart(2, '0')).join('')}`;
}

/** Compõe `top` (com alfa) sobre `bottom` opaco. */
export function blend(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: RGBA): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** WCAG: texto grande = ≥ 24px, ou ≥ 18.66px com peso ≥ 700. */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function rgbToLab({ r, g, b }: RGBA): Lab {
  const R = channel(r);
  const G = channel(g);
  const B = channel(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

/** CIEDE2000. */
export function deltaE2000(c1: Lab, c2: Lab): number {
  const rad = Math.PI / 180;
  const { l: L1, a: a1, b: b1 } = c1;
  const { l: L2, a: a2, b: b2 } = c2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = (Math.atan2(b1, a1p) / rad + 360) % 360;
  const h2p = (Math.atan2(b2, a2p) / rad + 360) % 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export function rgbToHsl({ r, g, b }: RGBA): HSL {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGBA {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a: 1 };
}

/**
 * Ajusta a luminosidade de `fg` (mantendo matiz e saturação) até atingir
 * `target` de contraste sobre `bg`. Escolhe a direção (clarear/escurecer)
 * que exige a menor alteração. Retorna null se impossível.
 */
export function fixContrast(fg: RGBA, bg: RGBA, target: number): RGBA | null {
  if (contrastRatio(fg, bg) >= target) return fg;
  const hsl = rgbToHsl(fg);
  const candidates: { color: RGBA; delta: number }[] = [];
  for (const dir of [-1, 1]) {
    for (let step = 1; step <= 100; step++) {
      const l = hsl.l + (dir * step) / 100;
      if (l < 0 || l > 1) break;
      const color = hslToRgb({ ...hsl, l });
      if (contrastRatio(color, bg) >= target) {
        candidates.push({ color, delta: step });
        break;
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.delta - b.delta);
  return candidates[0]!.color;
}

export function bestTextOn(bg: RGBA): { color: RGBA; ratio: number } {
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const ink = { r: 17, g: 17, b: 19, a: 1 };
  const rw = contrastRatio(white, bg);
  const ri = contrastRatio(ink, bg);
  return rw >= ri ? { color: white, ratio: rw } : { color: ink, ratio: ri };
}
