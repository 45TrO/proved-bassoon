# UI Doctor — registro de progresso

## Estado: versão 1.0 funcional

### Backend (`server/`)
- Proteção anti-SSRF: validação de URL e DNS, mais proxy de saída com IP fixado.
- Captura isolada em 3 resoluções; detecção de erros de JavaScript da página.
- Motor de regras com evidência: visual, UX, acessibilidade, responsividade e identidade.
- Pontuação transparente.
- Página renderizada em branco **falha com explicação**, em vez de receber nota.
- **Sem IA:** pipeline de visão computacional com OCR (Tesseract, offline), processamento de imagem (Sobel, XY-cut, componentes conexos, CLAHE), reconhecimento de padrões e parsing de DOM (parse5), supervisionado por um sistema de regras (monitor M1–M4) com rastro auditável. Ver `docs/VISION.md`.
- Contraste por pixels calibrado contra texto com cores conhecidas (erro médio de −12% para ±3%), com teste de calibração permanente.
- Imagens importadas agora recebem diagnóstico e nota; a responsividade fica como "não medida".
- Antes e depois com CSS sanitizado, recaptura e re-medição. Em botões, o contraste é corrigido escurecendo o fundo e mantendo o texto e o matiz. O modo "Harmonização completa" (por regras) unifica variantes de componentes, cores quase iguais e fontes excedentes.
- SQLite nativo; fila com progresso; API Fastify protegida; entrega do SPA com 404 correto para assets.

### Frontend (`web/`)
- Início, Resultado (Diagnóstico, Identidade visual, Responsividade, Antes e depois), Painel, Projetos, Projeto, 404.
- Inspetor de evidências com spotlight e etiquetas de dimensão sem sobreposição.
- Tema claro e escuro, responsivo até 390 px, foco visível, alvos de toque de 44 px, tokens de cor que passam WCAG AA.

### Qualidade
- 86 testes no servidor (incluindo E2E no navegador e calibração de visão) e 23 no frontend.
- **Autodiagnóstico:** o UI Doctor analisou as próprias páginas. Os problemas reais encontrados (contraste do token `--faint` e das severidades, alvos de toque pequenos, desalinhamento de grades, overflow transitório de gráfico no mobile) foram corrigidos. Início, Painel e Projetos medem 100.
- Falsos positivos encontrados e corrigidos (os dois primeiros com teste de regressão; os demais validados re-analisando as páginas):
  - SVG ampliado ou "distorcido";
  - camadas de superfície neutras tratadas como cores acidentais;
  - escala de espaçamento Tailwind (meios-passos de 2 px);
  - imagens com moldura interna em cards;
  - cores de status com área ínfima contando como dispersão de paleta.

## Próximos passos sugeridos
- Proposta visual (antes e depois) para imagens importadas.
- Ampliar o reconhecimento de padrões: botões só com contorno, campos, cards repetidos.
- Fila externa (ex.: Redis) e armazenamento de capturas em objeto (S3) para escalar horizontalmente.
- Autenticação e contas multiusuário para uso comercial.
- Analisar sites públicos reais: o ambiente de desenvolvimento desta sessão bloqueia hosts externos, então a validação foi feita com páginas locais.
