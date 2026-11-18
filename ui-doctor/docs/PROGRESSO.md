# UI Doctor — registro de progresso

## Estado: versão 1.0 funcional

### Backend (`server/`)
- Proteção anti-SSRF: validação de URL e DNS, mais proxy de saída com IP fixado.
- Captura isolada em 3 resoluções; detecção de erros de JavaScript da página.
- Motor de regras com evidência: visual, UX, acessibilidade, responsividade e identidade.
- Pontuação transparente.
- Página renderizada em branco **falha com explicação**, em vez de receber nota.
- IA (Claude) opcional, com descarte de achados sem evidência verificável.
- Antes e depois com CSS sanitizado, recaptura e re-medição. Em botões, o contraste é corrigido escurecendo o fundo e mantendo o texto e o matiz.
- SQLite nativo; fila com progresso; API Fastify protegida; entrega do SPA com 404 correto para assets.

### Frontend (`web/`)
- Início, Resultado (Diagnóstico, Identidade visual, Responsividade, Antes e depois), Painel, Projetos, Projeto, 404.
- Inspetor de evidências com spotlight e etiquetas de dimensão sem sobreposição.
- Tema claro e escuro, responsivo até 390 px, foco visível, alvos de toque de 44 px, tokens de cor que passam WCAG AA.

### Qualidade
- 75 testes no servidor (incluindo E2E no navegador) e 22 no frontend.
- **Autodiagnóstico:** o UI Doctor analisou as próprias páginas. Os problemas reais encontrados (contraste do token `--faint` e das severidades, alvos de toque pequenos, desalinhamento de grades, overflow transitório de gráfico no mobile) foram corrigidos. Início, Painel e Projetos medem 100.
- Falsos positivos encontrados e corrigidos, com testes de regressão:
  - SVG ampliado ou "distorcido";
  - camadas de superfície neutras tratadas como cores acidentais;
  - escala de espaçamento Tailwind (meios-passos de 2 px);
  - imagens com moldura interna em cards;
  - cores de status com área ínfima contando como dispersão de paleta.

## Próximos passos sugeridos
- Testar a revisão por IA com uma `ANTHROPIC_API_KEY` real. Até aqui foi validada com um provedor simulado.
- Proposta visual para imagens importadas (exige gerar uma recriação da interface).
- Fila externa (ex.: Redis) e armazenamento de capturas em objeto (S3) para escalar horizontalmente.
- Autenticação e contas multiusuário para uso comercial.
- Analisar sites públicos reais: o ambiente de desenvolvimento desta sessão bloqueia hosts externos, então a validação foi feita com páginas locais.
