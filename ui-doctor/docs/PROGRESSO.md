# UI Doctor — registro de progresso

## Pronto e testado (backend, 2 commits na branch `ccr-16ad08c4-557l65`)

- **Segurança anti-SSRF**: validação de URL (esquemas, credenciais, portas, nomes internos, IPs em notação decimal/hex/octal/IPv6, DNS com todos os registros) e proxy de saída com IP fixado. Todo o tráfego do Chromium passa por ele.
- **Captura** com Playwright em desktop 1440, tablet 834 e mobile 390, em contexto isolado (sem service workers, pop-ups, downloads, QUIC nem WebRTC UDP).
- **Coletor de DOM** e **motor de regras** com evidência real (seletor, retângulo, valores medidos):
  - visual, UX, acessibilidade, responsividade e identidade visual;
  - paleta por CIELAB/ΔE2000, tipografia e paletas sugeridas com contraste verificado.
- **Pontuação** transparente (UI, UX, geral, por categoria).
- **IA (Claude)** opcional via `ANTHROPIC_API_KEY`, com saída estruturada e `fallbacks: "default"`. Achados sem seletor real ou região válida são descartados.
- **Antes e depois**: CSS de correção determinístico e sanitizado, recaptura da página real e re-medição. A IA complementa no modo "preservar" e é obrigatória no modo "reformulação completa".
- **Imagem importada**: magic bytes, paleta por pixels em contexto offline. Sem IA, não atribui nota.
- **Persistência e API**:
  - SQLite nativo (projetos, favoritos, histórico, status dos problemas, redesigns);
  - fila de jobs com progresso;
  - API Fastify com Zod, helmet, rate limit e entrega de arquivos protegida contra path traversal.
- **Testes do servidor**: 69 passando (segurança, unidades, pipeline real, API ponta a ponta, IA simulada).

## Em andamento (frontend, ainda NÃO commitado nem compilado)

Escrito em `web/`:
- configuração Vite/TS/Tailwind v4 e tokens de design (IBM Plex, tema claro e escuro, cores de série validadas);
- `lib/` (API, formatação e validação, hooks, tema);
- componentes base (Button, Tabs, ScoreRing, SeverityBadge, Toast, estados vazios e de erro);
- AppShell com sidebar e gaveta mobile;
- gráficos: evolução UI/UX com tabela alternativa, barras, severidade empilhada, sparkline;
- AnalyzeForm (URL e upload), Inspector (screenshot com caixas de evidência e spotlight), IssueList, ScoreSummary, ProgressView, IdentityPanel, ResponsivePanel.

**O que eu estava fazendo ao parar:** escrevendo `components/analysis/BeforeAfter.tsx`. Ele terá controle deslizante acessível, modo lado a lado, alternância desktop/mobile, delta de nota e de problemas, lista de alterações e "copiar CSS".

## Falta

1. `BeforeAfter.tsx`.
2. Páginas: Início (formulário central, projetos recentes, indicadores), Resultado (abas Diagnóstico / Identidade / Responsividade / Antes e depois), Painel, Projetos, Projeto, 404; `main.tsx` e `App.tsx` com rotas.
3. `src/test/setup.ts` e testes do frontend (validação do formulário, filtros de problemas, componentes).
4. Rodar typecheck e build do web, corrigir erros, subir servidor e frontend e revisar visualmente com screenshots (desktop e mobile, claro e escuro).
5. Teste E2E do fluxo completo no navegador.
6. Servir o build do web pelo Fastify em produção; README com instalação, variáveis de ambiente, segurança e deploy (incluindo o sandbox do Chromium como não-root); `.env.example`.
7. Commit e push.

## Observações

- Nesta sessão, a política de rede bloqueia sites externos. Os testes usam fixtures locais liberados por `UIDOCTOR_ALLOW_PRIVATE_HOSTS`, que vale apenas para teste.
- As vulnerabilidades apontadas pelo `npm audit` estão só em Vite e Vitest (ferramentas de desenvolvimento, fora do bundle de produção).
