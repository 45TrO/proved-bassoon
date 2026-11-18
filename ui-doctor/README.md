# UI Doctor

Plataforma de diagnóstico de interfaces. Ela abre um site em um navegador isolado, captura a página em três resoluções, mede cada elemento e aponta problemas de layout, UX, acessibilidade, responsividade e identidade visual. **Cada problema vem com a evidência real**: o elemento na captura, o seletor CSS e os valores medidos.

- **Diagnóstico com evidência**: o inspetor desenha cada problema sobre o screenshot, com dimensões e spotlight no elemento.
- **Notas transparentes**: UI, UX, geral e por categoria, com fórmula documentada (`server/src/analysis/scoring.ts`).
- **Identidade visual**: paleta ponderada por área, tipografia, pares de contraste WCAG e paletas recomendadas.
- **Antes e depois**: aplica correções na página real, recaptura e **mede de novo**. A melhoria exibida é medida, não estimada.
- **IA opcional (Claude)**: complementa as regras com revisão visual. Achados sem elemento ou região verificável são descartados.
- **Painel, projetos, favoritos e histórico**, com problemas marcados como corrigidos.
- **Importação de captura de tela**: paleta por pixels; revisão de UX apenas com IA, sem nota inventada.

## Requisitos

- Node.js 22.13 ou superior (usa `node:sqlite`, sem dependências nativas)
- Chromium para o Playwright (`npx playwright install chromium`, se ainda não estiver instalado)

## Como rodar

```bash
cd ui-doctor
npm install
cp .env.example .env        # ajuste o que precisar

# Desenvolvimento: API em :8787 e frontend em :5173 (proxy de /api)
npm run dev

# Produção: o servidor entrega a API e o frontend compilado
npm run build
npm start                   # http://127.0.0.1:8787
```

As variáveis de ambiente estão documentadas em `.env.example`. Para ativar a IA, defina `ANTHROPIC_API_KEY`.

## Testes

```bash
npm test            # servidor (segurança, regras, pipeline real, API) + frontend
npm run test:e2e    # fluxo completo no navegador sobre o build de produção
npm run typecheck
```

Os testes de integração sobem páginas locais de exemplo (`server/test/fixtures`), entre elas uma propositalmente cheia de problemas, uma limpa e uma loja realista. Também sobem um **servidor interno sentinela**, que deve receber **zero** requisições durante as análises.

## Arquitetura

Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
web/      React 19 + React Router 7 + Tailwind v4 (componentes próprios, gráficos SVG)
server/   Fastify + Playwright + SQLite (node:sqlite) + Zod + SDK da Anthropic
  security/   validação de URL e proxy de saída anti-SSRF
  capture/    navegador isolado, coletor de DOM, análise de imagens
  analysis/   regras, identidade visual, pontuação
  ai/         integração com Claude e validação de evidências
  redesign/   CSS de correção e sanitizador
  services/   orquestração de análises e propostas (fila em processo)
```

## Segurança

| Risco | Proteção |
|---|---|
| SSRF (rede interna, metadados de nuvem) | Validação de esquema, credenciais, portas (80/443/8080/8443), nomes internos e IPs em qualquer notação. O DNS é resolvido e **todos** os endereços precisam ser públicos. |
| Redirects, sub-recursos, fetch, WebSocket | Todo o tráfego do Chromium passa por um proxy de saída que revalida cada conexão e conecta no IP já validado (impede DNS rebinding). QUIC e WebRTC UDP desativados. |
| Conteúdo não confiável | Contexto efêmero por análise: sem service workers, downloads, permissões nem pop-ups, com limites de tempo, de requisições e de bytes. O frontend só exibe imagens, nunca HTML capturado. |
| CSS gerado (IA/regras) | Sanitizador remove `@import`, `url()`, `expression`, `javascript:`, escapes e comentários que escondem construções. |
| Upload | Tipo verificado por *magic bytes*, até 10 MB; imagem processada num contexto do Chromium **offline**. |
| API | Validação Zod, rate limit nas criações, helmet com CSP restrita, arquivos servidos por nome validado (sem path traversal). |

**Em produção:** rode o servidor como usuário **não-root** com `UIDOCTOR_CHROMIUM_SANDBOX=true`, atrás de um proxy reverso com TLS. Nunca use `UIDOCTOR_ALLOW_PRIVATE_HOSTS` fora de testes.

## Limitações conhecidas

- Páginas que exigem login, ou que só renderizam após interação, são capturadas como o visitante anônimo as vê. Uma página sem conteúdo visível falha com explicação em vez de receber nota.
- A captura é limitada a 8.000 px de altura e 2.500 elementos visíveis por resolução. Isso aparece no relatório quando acontece.
- Sem `ANTHROPIC_API_KEY`, imagens importadas recebem só paleta e sugestões, sem nota.
- A fila é em processo: para escalar horizontalmente, troque `jobs/queue.ts` por uma fila externa.
- As vulnerabilidades apontadas por `npm audit` estão em ferramentas de desenvolvimento (Vite e Vitest), que não fazem parte do build de produção.
