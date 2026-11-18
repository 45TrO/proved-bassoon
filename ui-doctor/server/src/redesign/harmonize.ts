import { extractTypography } from '../analysis/identity.js';
import { deltaE2000, parseColor, rgbToLab, toHex } from '../analysis/color.js';
import type { Snapshot, SnapEl } from '../capture/snapshot.js';
import type { RedesignChange, ViewportName } from '../domain/types.js';
import { findComponentVariants } from '../vision/patterns.js';
import { safeSelector } from './cssSanitizer.js';

/**
 * Harmonização por regras (modo "reformulação completa"). Vai além das
 * correções pontuais e unifica o sistema visual a partir do que foi medido:
 *  H1 variantes acidentais de botões/campos adotam a assinatura dominante;
 *  H2 cores quase iguais (ΔE2000 < 6, com croma) convergem para a mais usada;
 *  H3 famílias tipográficas além das duas principais passam para a família de texto.
 */
const MAX_RULES = 300;

const hexOf = (c: string): string | null => {
  const p = parseColor(c);
  return p && p.a > 0.5 ? toHex(p) : null;
};

export function buildHarmonization(snapshots: Partial<Record<ViewportName, Snapshot>>): { css: string; changes: RedesignChange[] } {
  const snap = snapshots.desktop ?? snapshots.mobile;
  if (!snap) return { css: '', changes: [] };
  const els = snap.elements.filter((e) => !e.hidden && safeSelector(e.selector));
  const rules: string[] = [];
  const changes: RedesignChange[] = [];
  const add = (title: string, detail: string, el: SnapEl, css: string) => {
    if (rules.length >= MAX_RULES) return;
    rules.push(css);
    changes.push({ id: `harm-${changes.length}`, title, detail, selector: el.selector, css, source: 'rules' });
  };

  // H1: variantes acidentais
  for (const v of findComponentVariants(els).variants) {
    const d = v.dominant.example;
    const bg = hexOf(d.ownBg);
    const css = `${v.outlier.selector} { border-radius: ${d.radius}px !important; min-height: ${d.h}px !important; font-size: ${d.fontSize}px !important;${bg ? ` background-color: ${bg} !important;` : ''} }`;
    add('Componente unificado', `${v.kind[0]!.toUpperCase()}${v.kind.slice(1)} "${(v.outlier.text || v.outlier.name).slice(0, 30)}" adota o padrão dominante (${v.differences.join('; ')}).`, v.outlier, css);
  }

  // H2: cores quase iguais → a mais frequente
  const usage = new Map<string, number>();
  for (const e of els) {
    for (const c of [hexOf(e.color), hexOf(e.ownBg)]) if (c) usage.set(c, (usage.get(c) ?? 0) + 1);
  }
  const colors = [...usage.keys()];
  const canonical = new Map<string, string>();
  for (const a of colors) {
    const la = parseColor(a)!;
    if (Math.hypot(rgbToLab(la).a, rgbToLab(la).b) < 12) continue; // neutros ficam como estão
    for (const b of colors) {
      if (a === b) continue;
      const lb = parseColor(b)!;
      const d = deltaE2000(rgbToLab(la), rgbToLab(lb));
      if (d >= 0.5 && d < 6 && (usage.get(b) ?? 0) > (usage.get(a) ?? 0)) {
        const current = canonical.get(a);
        if (!current || (usage.get(b) ?? 0) > (usage.get(current) ?? 0)) canonical.set(a, b);
      }
    }
  }
  for (const e of els) {
    const fg = hexOf(e.color);
    if (fg && canonical.has(fg) && e.ownText) add('Cor unificada', `Texto em ${fg} passa a usar ${canonical.get(fg)} (tom quase idêntico mais usado).`, e, `${e.selector} { color: ${canonical.get(fg)} !important; }`);
    const bg = hexOf(e.ownBg);
    if (bg && canonical.has(bg)) add('Cor unificada', `Fundo em ${bg} passa a usar ${canonical.get(bg)} (tom quase idêntico mais usado).`, e, `${e.selector} { background-color: ${canonical.get(bg)} !important; }`);
  }

  // H3: famílias tipográficas excedentes
  const families = extractTypography(snap);
  if (families.length > 2) {
    const keep = new Set(families.slice(0, 2).map((f) => f.family));
    const body = families[0]!.family.replace(/["\\;{}]/g, '');
    for (const e of els) {
      if (!e.ownText || keep.has(e.fontFamily)) continue;
      add('Tipografia consolidada', `"${e.text.slice(0, 30)}" em ${e.fontFamily} passa para ${body}, a família principal.`, e, `${e.selector} { font-family: "${body}", system-ui, sans-serif !important; }`);
    }
  }

  return { css: rules.length ? `/* UI Doctor — harmonização por regras */\n${rules.join('\n')}` : '', changes };
}
