# UI Doctor — Arquitetura

## Visão geral

```
┌──────────────────────────┐        HTTP/JSON         ┌───────────────────────────────────────────────┐
│  web (React + Vite)      │  ─────────────────────▶  │  server (Fastify + TypeScript)                │
│  Tailwind v4, Router 7   │  ◀── polling de status ── │                                               │
└──────────────────────────┘                           │  routes ─▶ jobs (fila em processo)            │
                                                       │              │                                │
                                                       │              ▼                                │
                                                       │   capture (Playwright/Chromium)               │
                                                       │     │  todo tráfego ─▶ egress proxy (SSRF)    │
                                                       │     ▼                                         │
                                                       │   collector (snapshot do DOM por viewport)    │
                                                       │     ▼                                         │
                                                       │   rules (motor determinístico de regras)      │
                                                       │     ▼                                         │
                                                       │   ai (Claude, opcional, validado por evidência)│
                                                       │     ▼                                         │
                                                       │   scoring ─▶ SQLite (node:sqlite) + PNGs      │
                                                       │                                               │
                                                       │   redesign: CSS de correção injetado e        │
                                                       │   re-medido na página real (antes/depois)     │
                                                       └───────────────────────────────────────────────┘
```

## Princípio central: nenhum diagnóstico sem evidência

Todo problema (`Issue`) carrega um objeto `evidence` com:

- `viewport` onde foi medido (desktop 1440×900, tablet 834×1112, mobile 390×844);
- `selector` CSS do elemento real e `rect` (coordenadas na captura de tela);
- `measured`: os valores numéricos que dispararam a regra (ex.: contraste 2.8:1, alvo de toque 28×18 px, overflow de 112 px).

A interface desenha o `rect` sobre o screenshot. Achados da IA só são aceitos se apontarem
um seletor que existe no inventário coletado ou uma região dentro dos limites da captura;
o restante é descartado (`ai/validate.ts`).

## Módulos do servidor

| Módulo | Responsabilidade |
|---|---|
| `security/urlGuard.ts` | Valida esquema, credenciais, porta e host; resolve DNS e rejeita IPs privados, loopback, link-local, CGNAT, multicast, reservados, IPv4 mapeado em IPv6, metadados de nuvem. |
| `security/egressProxy.ts` | Proxy HTTP/CONNECT local por onde **todo** o tráfego do Chromium passa. Revalida cada conexão (redirects, sub-recursos, fetch/XHR, WebSocket) e conecta ao IP já validado, o que elimina DNS rebinding. |
| `capture/browser.ts` | Chromium com `--proxy-server`, `<-loopback>` (sem bypass para localhost), QUIC e WebRTC UDP desativados. Contexto efêmero por análise: sem service workers, downloads, permissões nem pop-ups; limites de tempo e de tamanho. |
| `capture/collector.ts` | Script executado na página que produz um snapshot serializável: elementos visíveis, estilos computados, cores efetivas, formulários, títulos, imagens, métricas de overflow. |
| `analysis/rules/*` | Regras puras `(snapshot) → Issue[]`: visual, UX, acessibilidade, responsividade e identidade visual. |
| `analysis/scoring.ts` | Pontuação UI/UX/geral com fórmula transparente: peso por severidade, com retorno decrescente por regra. |
| `analysis/identity.ts` | Extração de paleta ponderada por área (agrupamento em CIELAB / ΔE2000), tipografia e paletas recomendadas com contraste verificado. |
| `ai/*` | Integração com Claude (visão + saída estruturada Zod). Opcional, ligada por `ANTHROPIC_API_KEY`. |
| `redesign/*` | Gera CSS de correção a partir dos problemas, injeta na página real, captura o "depois" e **re-executa as regras** para medir a melhoria. |
| `jobs/queue.ts` | Fila em processo com concorrência configurável, progresso por etapas e recuperação após reinício. |
| `db/*` | SQLite via `node:sqlite` (sem dependências nativas). |

## Fluxo de análise

1. `POST /api/analyses { url }`: valida com Zod e passa pelo `urlGuard` (falha rápida).
2. O job entra na fila; o status é `queued → capturing → analyzing → scoring → done | failed`.
3. Para cada viewport: navega pelo proxy seguro, rola a página para carregar conteúdo lazy, captura a página inteira (limitada a 8000 px de altura) e roda o collector.
4. As regras rodam sobre os snapshots. A IA, se habilitada, recebe screenshots e inventário e retorna achados que são validados.
5. A pontuação é calculada e o resultado é persistido. A interface acompanha por polling.

## Importação de imagem

Upload (PNG/JPEG/WebP, ≤ 10 MB, tipo verificado por *magic bytes*). O servidor extrai a paleta e
as dimensões a partir dos pixels, renderizando a imagem em um contexto do Chromium **sem rede e sem JS**.
Sem DOM, regras estruturais não se aplicam: a análise de UX/visual depende da IA e a
interface informa isso explicitamente, sem inventar resultados.

## Antes e depois

- **Preservar identidade** (padrão): correções determinísticas (contraste ajustado mantendo o matiz,
  alvos de toque, overflow, legibilidade, tamanho de texto no mobile, foco visível),
  com IA opcional para refinamentos sob as mesmas restrições.
- **Reformulação completa**: exige IA e é feita só a pedido do usuário.
- O CSS gerado passa por um sanitizador (sem `@import`, `url()`, `expression`, `javascript:`, `behavior`).
- A captura "depois" é a página real com o CSS aplicado, e as regras são reexecutadas para mostrar o delta medido.

## Segurança

- SSRF: validação estática e de DNS, mais o proxy de saída com IP fixado; portas permitidas 80/443/8080/8443.
- Conteúdo não confiável: roda apenas dentro do Chromium isolado; o frontend nunca renderiza HTML capturado, só PNGs.
- Arquivos servidos por nome validado com regex (sem path traversal).
- Rate limiting nos endpoints de criação, `@fastify/helmet`, limite de corpo e de upload.
- Em produção, rode o servidor como usuário não-root para que o sandbox do Chromium fique ativo (`UIDOCTOR_CHROMIUM_SANDBOX=true`).

## Frontend

React 19 + React Router 7 + Tailwind v4. Componentes próprios (sem kit genérico), ícones Lucide,
fontes Geist / Geist Mono, tema escuro por padrão com modo claro, gráficos SVG próprios.
