import fs from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Snapshot } from '../capture/snapshot.js';
import type { Issue, ViewportName } from '../domain/types.js';

/**
 * Integração com Claude (visão + saída estruturada).
 * A IA complementa o motor de regras; nunca o substitui. Todo achado precisa
 * apontar para um seletor real ou para uma região dentro da captura, e é
 * descartado caso contrário (ver validateFindings).
 */

const FindingSchema = z.object({
  category: z.enum(['visual', 'ux', 'accessibility', 'responsive', 'identity']),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  title: z.string(),
  description: z.string(),
  recommendation: z.string(),
  viewport: z.enum(['desktop', 'tablet', 'mobile', 'image']),
  selector: z.string().nullable(),
  region: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable(),
  observation: z.string(),
});

const AnalysisSchema = z.object({
  findings: z.array(FindingSchema),
});

const RedesignSchema = z.object({
  css: z.string(),
  changes: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      selector: z.string(),
    }),
  ),
});

export type AiFinding = z.infer<typeof FindingSchema>;

export interface AiImage {
  viewport: ViewportName | 'image';
  file: string;
  width: number;
  height: number;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface AiContext {
  model: string;
  images: AiImage[];
  snapshots: Partial<Record<ViewportName, Snapshot>>;
  ruleIssues: Issue[];
  pageTitle: string;
  url: string | null;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ maxRetries: 2, timeout: 180_000 });
  return client;
}

const SYSTEM = `Você é um especialista sênior em UI/UX e acessibilidade que audita interfaces reais.
Regras inegociáveis:
- Relate SOMENTE o que é visível nas imagens fornecidas ou comprovável pelo inventário de elementos.
- Cada achado precisa de evidência: um "selector" copiado EXATAMENTE do inventário, ou uma "region" (x, y, width, height em pixels da imagem) que delimite o problema visível.
- "observation" descreve objetivamente o que se vê naquele ponto (ex.: "o botão 'Comprar' tem a mesma cor do texto ao redor").
- Não repita problemas que já estão na lista do motor de regras.
- Não invente métricas. Se não houver problema relevante, retorne uma lista vazia.
- Escreva em português do Brasil, de forma direta e profissional.`;

function inventory(snapshots: AiContext['snapshots']): string {
  const lines: string[] = [];
  for (const vp of ['desktop', 'mobile'] as const) {
    const snap = snapshots[vp];
    if (!snap) continue;
    lines.push(`## ${vp} (${snap.viewport.width}×${snap.viewport.height})`);
    const els = snap.elements
      .filter((e) => !e.hidden && (e.interactive || e.kind === 'heading' || e.kind === 'img' || (e.ownText && e.words >= 3)))
      .filter((e) => e.y < 2400)
      .slice(0, 160);
    for (const e of els) {
      lines.push(`${e.selector} | ${e.kind} | ${e.x},${e.y},${e.w}×${e.h} | ${e.text.slice(0, 60).replace(/\s+/g, ' ')}`);
    }
  }
  return lines.join('\n');
}

async function imageBlocks(images: AiImage[], dir: string) {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const img of images) {
    const data = (await fs.readFile(path.join(dir, img.file))).toString('base64');
    blocks.push({ type: 'text', text: `Imagem "${img.viewport}" (${img.width}×${img.height} px, origem no canto superior esquerdo):` });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data } });
  }
  return blocks;
}

export interface AiAnalysisOutput {
  findings: AiFinding[];
  refused: boolean;
  model: string;
}

export async function aiAnalyze(ctx: AiContext, dir: string): Promise<AiAnalysisOutput> {
  const ruleSummary = ctx.ruleIssues.map((i) => `- [${i.category}] ${i.title}`).join('\n') || '(nenhum)';
  const response = await getClient().beta.messages.parse({
    model: ctx.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: betaZodOutputFormat(AnalysisSchema) },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          ...(await imageBlocks(ctx.images, dir)),
          {
            type: 'text',
            text: [
              `Página: ${ctx.pageTitle || '(sem título)'}${ctx.url ? ` — ${ctx.url}` : ''}`,
              '',
              'Problemas já detectados pelo motor de regras (não repetir):',
              ruleSummary,
              '',
              ctx.snapshots.desktop || ctx.snapshots.mobile
                ? `Inventário de elementos (seletor | tipo | x,y,largura×altura | texto):\n${inventory(ctx.snapshots)}`
                : 'Não há DOM disponível: trata-se de uma captura de tela importada. Use apenas "region" como evidência e viewport "image".',
              '',
              'Avalie hierarquia visual, organização, clareza da proposta, affordance dos botões, consistência de componentes, uso de cor e tipografia, e problemas de layout visíveis. Retorne no máximo 10 achados, priorizando os de maior impacto.',
            ].join('\n'),
          },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal') return { findings: [], refused: true, model: response.model };
  return { findings: response.parsed_output?.findings ?? [], refused: false, model: response.model };
}

/** Valida achados da IA contra a captura real. Retorna aceitos e quantidade rejeitada. */
export function validateFindings(findings: AiFinding[], ctx: Pick<AiContext, 'images' | 'snapshots'>): { issues: Issue[]; rejected: number } {
  const issues: Issue[] = [];
  let rejected = 0;
  findings.forEach((f, idx) => {
    const image = ctx.images.find((i) => i.viewport === f.viewport);
    if (!image || !f.observation.trim()) {
      rejected++;
      return;
    }
    let rect: Issue['evidence'][number]['rect'];
    let selector: string | undefined;
    let snippet: string | undefined;
    if (f.selector && f.viewport !== 'image') {
      const el = ctx.snapshots[f.viewport]?.elements.find((e) => e.selector === f.selector!.trim());
      if (el) {
        selector = el.selector;
        rect = { x: el.x, y: el.y, width: el.w, height: el.h };
        snippet = el.text || undefined;
      }
    }
    if (!rect && f.region) {
      const r = f.region;
      const inside = r.width > 4 && r.height > 4 && r.x >= 0 && r.y >= 0 && r.x + r.width <= image.width + 2 && r.y + r.height <= image.height + 2;
      if (inside) rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    }
    if (!rect) {
      rejected++;
      return;
    }
    issues.push({
      id: `ai.${idx}`,
      ruleId: 'ai.review',
      source: 'ai',
      category: f.category,
      severity: f.severity,
      title: f.title,
      description: f.description,
      recommendation: f.recommendation,
      evidence: [{ viewport: f.viewport, selector, rect, snippet, measured: { observação: f.observation } }],
      occurrences: 1,
      fixable: false,
    });
  });
  return { issues, rejected };
}

export interface AiRedesignInput {
  model: string;
  mode: 'preserve' | 'full';
  images: AiImage[];
  snapshots: Partial<Record<ViewportName, Snapshot>>;
  issues: Issue[];
  baseCss: string;
}

export async function aiRedesignCss(input: AiRedesignInput, dir: string) {
  const guidance =
    input.mode === 'preserve'
      ? 'PRESERVE a identidade: mantenha cores de marca (apenas ajuste luminosidade quando necessário), fontes, logotipo, estrutura e finalidade. Faça melhorias de refinamento: espaçamento, alinhamento, hierarquia, consistência de botões, legibilidade.'
      : 'O usuário pediu uma REFORMULAÇÃO COMPLETA do visual. Você pode redefinir paleta, tipografia (apenas fontes do sistema: system-ui, Georgia, ui-monospace), espaçamentos e estilo dos componentes, mantendo o conteúdo e a finalidade da página.';
  const response = await getClient().beta.messages.parse({
    model: input.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: betaZodOutputFormat(RedesignSchema) },
    system:
      'Você é um designer de interfaces sênior que escreve CSS de produção. Gere apenas CSS que será injetado sobre a página existente. ' +
      'Proibido: @import, url(), expression(), javascript:, behavior, -moz-binding, conteúdo gerado com texto novo. ' +
      'Use somente seletores copiados do inventário fornecido ou seletores de tag genéricos (body, h1, p, button, a). Cada mudança precisa citar o seletor que altera.',
    messages: [
      {
        role: 'user',
        content: [
          ...(await imageBlocks(input.images, dir)),
          {
            type: 'text',
            text: [
              guidance,
              '',
              'Problemas diagnosticados:',
              input.issues.slice(0, 25).map((i) => `- [${i.severity}] ${i.title}: ${i.evidence.map((e) => e.selector).filter(Boolean).slice(0, 3).join(', ')}`).join('\n'),
              '',
              'CSS de correções automáticas já aplicado (não repetir):',
              input.baseCss || '(nenhum)',
              '',
              `Inventário de elementos:\n${inventory(input.snapshots)}`,
            ].join('\n'),
          },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
  return response.parsed_output;
}
