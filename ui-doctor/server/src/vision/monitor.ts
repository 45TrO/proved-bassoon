import { elementContrast } from '../analysis/rules/accessibility.js';
import type { SnapEl } from '../capture/snapshot.js';
import type { Issue, Rect, Severity, TraceEntry } from '../domain/types.js';
import { containment, iou, type Candidate, type Facts } from './facts.js';

/**
 * Monitor baseado em regras. Decide o destino de cada achado proposto pelos
 * módulos de visão e registra o motivo, gerando um rastro auditável:
 *
 *  M1  evidência dentro dos limites da captura      → senão rejeita
 *  M2  confiança < 0.6                              → rejeita
 *      confiança 0.6–0.75                           → rebaixa a severidade
 *  M3  contraste por pixels × contraste medido no DOM:
 *      DOM aprova o mesmo texto                     → rejeita (DOM é a fonte mais precisa)
 *      DOM já reprova o mesmo texto                 → corrobora o problema existente
 *  M4  mesmo problema já detectado pelas regras do DOM (mesma categoria e
 *      evidência sobreposta)                        → corrobora em vez de duplicar
 */
const DOWNGRADE: Record<Severity, Severity> = { critical: 'high', high: 'medium', medium: 'low', low: 'low' };

/**
 * Elementos de texto do DOM correspondentes a uma linha lida pelo OCR, nas duas direções:
 *  - elementos contidos na linha (o OCR pode juntar vários links de um menu numa linha só);
 *  - o elemento de texto mais interno que contém a linha (um parágrafo é um bloco mais largo que seus glifos).
 */
export function domTextFor(elements: SnapEl[], line: Rect): SnapEl[] {
  const texts = elements.filter((x) => x.ownText && x.words > 0 && !x.hidden);
  const rectOf = (x: SnapEl): Rect => ({ x: x.x, y: x.y, width: x.w, height: x.h });
  const inside = texts.filter((x) => containment(rectOf(x), line) > 0.5);
  const containers = texts.filter((x) => containment(line, rectOf(x)) > 0.6).sort((a, b) => a.w * a.h - b.w * b.h);
  return [...new Set([...inside, ...containers.slice(0, 1)])];
}

export interface MonitorOutput {
  accepted: Issue[];
  trace: TraceEntry[];
  counts: { accepted: number; rejected: number; corroborated: number; downgraded: number };
}

function corroborate(issue: Issue, modules: string[]) {
  issue.corroboration = [...new Set([...(issue.corroboration ?? []), ...modules])];
}

export function monitor(candidates: Candidate[], facts: Facts): MonitorOutput {
  const trace: TraceEntry[] = [];
  const accepted: Issue[] = [];
  const counts = { accepted: 0, rejected: 0, corroborated: 0, downgraded: 0 };
  const log = (rule: string, outcome: TraceEntry['outcome'], reason: string) => {
    trace.push({ rule, outcome, reason });
    counts[outcome]++;
  };

  candidates.forEach((c, idx) => {
    // M1: limites
    const bounds = (viewport: string) => facts.images.find((i) => i.viewport === viewport);
    const inside = c.evidence.filter((e) => {
      if (!e.rect) return Boolean(e.selector) || Object.keys(e.measured).length > 0;
      const img = bounds(e.viewport);
      if (!img) return e.viewport === 'desktop' && Boolean(e.selector); // achados do DOM estático
      return e.rect.x >= -2 && e.rect.y >= -2 && e.rect.width > 0 && e.rect.height > 0 && e.rect.x + e.rect.width <= img.width + 2 && e.rect.y + e.rect.height <= img.height + 2;
    });
    if (inside.length === 0) {
      log(c.rule, 'rejected', 'Nenhuma evidência dentro da área capturada.');
      return;
    }
    if (inside.length < c.evidence.length) trace.push({ rule: c.rule, outcome: 'rejected', reason: `${c.evidence.length - inside.length} evidência(s) fora da captura descartadas.` });
    let evidence = inside;

    // M2: confiança
    if (c.confidence < 0.6) {
      log(c.rule, 'rejected', `Confiança ${Math.round(c.confidence * 100)}% abaixo do mínimo de 60%.`);
      return;
    }
    let severity = c.severity;

    // M3: contraste por pixels confrontado com o DOM
    if (c.rule === 'vision.ocr-contrast' && facts.source === 'url') {
      const domIssue = facts.ruleIssues.find((i) => i.ruleId === 'a11y.contrast');
      const kept = [];
      for (const e of evidence) {
        const snap = facts.snapshots[e.viewport as 'desktop' | 'mobile'];
        // Elementos de texto do DOM cobertos pela linha lida (o OCR pode juntar vários numa linha só).
        const covered = e.rect && snap ? domTextFor(snap.elements, e.rect) : [];
        if (covered.length === 0) {
          kept.push(e); // texto só existe nos pixels (imagem, canvas): a medição por pixels é a única fonte
          continue;
        }
        const measuredDom = covered.map((x) => ({ el: x, c: elementContrast(x) })).filter((m) => m.c);
        const failing = measuredDom.filter((m) => m.c!.ratio < m.c!.required);
        if (measuredDom.length > 0 && failing.length === 0) {
          const best = Math.min(...measuredDom.map((m) => m.c!.ratio));
          trace.push({ rule: c.rule, outcome: 'rejected', reason: `"${(e.snippet ?? '').slice(0, 40)}": o DOM mede ${best}:1 ou mais nos ${measuredDom.length} elemento(s) cobertos (aprovado); a leitura por pixels foi afetada pela suavização de borda.` });
          counts.rejected++;
          continue;
        }
        if (failing.length > 0 && domIssue) {
          // O DOM também reprova este texto: mesma conclusão por dois métodos independentes.
          corroborate(domIssue, ['OCR', 'Imagem']);
          trace.push({ rule: c.rule, outcome: 'corroborated', reason: `"${(e.snippet ?? '').slice(0, 40)}": confirmado nos pixels (${e.measured.ratio}:1) e no DOM.` });
          counts.corroborated++;
          continue;
        }
        // Sem medição de DOM utilizável (ex.: texto sobre imagem de fundo): vale a medição por pixels.
        kept.push(e);
      }
      if (kept.length === 0) return;
      evidence = kept;
    }

    // M4: duplicidade com regras do DOM
    const dup = facts.ruleIssues.find(
      (i) =>
        i.category === c.category &&
        i.evidence.some((d) => d.rect && evidence.some((e) => e.rect && e.viewport === d.viewport && (iou(d.rect!, e.rect!) > 0.3 || containment(e.rect!, d.rect!) > 0.8))),
    );
    if (dup && c.rule !== 'vision.ocr-contrast') {
      corroborate(dup, c.modules);
      log(c.rule, 'corroborated', `Mesmo problema já medido no DOM ("${dup.title}"); registrado como confirmação.`);
      return;
    }

    if (c.confidence < 0.75 && severity !== DOWNGRADE[severity]) {
      severity = DOWNGRADE[severity];
      log(c.rule, 'downgraded', `Confiança ${Math.round(c.confidence * 100)}%: severidade rebaixada para ${severity}.`);
    }
    accepted.push({
      id: `${c.rule}#${idx}`,
      ruleId: c.rule,
      source: 'vision',
      category: c.category,
      severity,
      title: c.title,
      description: c.description,
      recommendation: c.recommendation,
      evidence: evidence.slice(0, 12),
      occurrences: c.occurrences ?? evidence.length,
      fixable: false,
      corroboration: c.modules,
    });
    log(c.rule, 'accepted', `${evidence.length} evidência(s); módulos: ${c.modules.join(', ')}; confiança ${Math.round(c.confidence * 100)}%.`);
  });

  return { accepted, trace, counts };
}
