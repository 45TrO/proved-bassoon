# Pipeline de visão computacional

O UI Doctor não usa modelos de IA. O diagnóstico complementar ao DOM vem de um
pipeline clássico e determinístico, **supervisionado por um sistema baseado em
regras**. A mesma entrada sempre produz o mesmo resultado, e cada decisão é
registrada com o motivo.

```
captura / imagem ──► Processamento de imagem ─┐
                 ──► OCR (Tesseract, offline) ─┤
HTML renderizado ──► Parsing de DOM (parse5) ──┼──► fatos ──► regras ──► monitor ──► achados + rastro
snapshot do DOM ───► Reconhecimento de padrões ┘
```

## Módulos (`server/src/vision/`)

| Módulo | Técnicas | Fatos produzidos |
|---|---|---|
| `imageOps.ts` | sharp/libvips; tons de cinza; gradiente de **Sobel**; máscara de bordas; segmentação **XY-cut** por perfis de projeção; **componentes conexos** sobre cor quantizada; amostragem de cor local | blocos de conteúdo, densidade de bordas, ocupação da dobra, superfícies retangulares, cores de texto e fundo |
| `ocr.ts` | **Tesseract** (WASM), português + inglês, dados de idioma empacotados (sem rede); PSM 3 para página e PSM 7 para rótulos | linhas e palavras com caixa e confiança |
| `patterns.ts` | reconhecimento por forma + conteúdo; agrupamento por assinatura visual; *clustering* por vãos | botões, campos, itens de menu, variantes acidentais de componentes |
| `domParser.ts` | **parse5** (parser conforme a especificação HTML) | título, meta description, marcação obsoleta, tabindex positivo, iframes sem título, autoplay, links vazios, divs clicáveis, imagens sem dimensões, estilos inline |
| `rules.ts` | regras de produção (condição → achado com confiança) | achados candidatos |
| `monitor.ts` | sistema de regras supervisor | achados aceitos, corroborações, rejeições, rastro |

### Pré-processamento do OCR

- **CLAHE** (equalização adaptativa de histograma, janela 48 px, inclinação 6) antes do OCR. Sem ela, o Tesseract descarta justamente o texto de baixo contraste: na fixture `flawed.html`, a frase cinza `#b5b5b5` só é lida com CLAHE, a 94% de confiança.
- **Passada invertida** quando mais de 12% da imagem é escura, para ler texto claro sobre fundo escuro.
- **Rótulos de botões** lidos em recortes da superfície ampliados 3×, em tons de cinza e com polaridade normalizada. Texto branco sobre botão colorido não é lido na página inteira.

## Calibração do contraste medido por pixels

A cor do texto é estimada pelos pixels mais distantes do fundo (o "núcleo" dos
glifos). Antes da calibração, usar 30% dos pixels **subestimava** o contraste em
11–13% em média, chegando a −25% em texto de 11–12 px, por causa da suavização de borda e
da compressão JPEG. O estimador foi calibrado contra texto renderizado com cores
conhecidas (8 pares × 6 tamanhos × 3 famílias):

| Núcleo | Erro médio PNG | Erro médio JPEG | 11–12 px |
|---|---|---|---|
| 30% (antes) | −11,3% | −12,8% | −21 a −25% |
| 8% | −2,9% | +0,1% | −6 a −10% |
| 4% | −1,5% | +4,0% | −1 a −6% |

O percentil escolhido depende da altura da linha (4% abaixo de 13 px, 8% até 16 px e 15% acima),
e o achado só é proposto quando o contraste fica abaixo do mínimo **mesmo
descontando a margem residual** (6%, 3% e 2%). O teste
`server/test/vision-calibration.test.ts` refaz essa medição e falha se o erro médio
por tamanho passar de 10%.

Verificações contra valores reais nas fixtures: cinza `#b5b5b5`/branco mede
**2,06:1** (real 2,06); rodapé `#b9aa9b`/`#fbf7f2` mede **2,15:1** (real 2,12).

## Regras de visão

| Regra | Origem | Dispara quando | Módulos |
|---|---|---|---|
| `vision.ocr-contrast` | URL e imagem | contraste por pixels < mínimo WCAG − margem calibrada; OCR ≥ 75%; fundo uniforme ≥ 50% | OCR, Imagem |
| `vision.text-in-image` | URL | ≥ 3 palavras lidas dentro de `<img>`/fundo e < 50% delas no alt | OCR, DOM |
| `vision.tiny-text` | imagem | fonte estimada < 11 px (só em linhas com ascendentes, cuja altura é confiável) | OCR |
| `vision.generic-labels` | imagem | botão reconhecido com rótulo genérico ("Clique aqui", "Ok") | OCR, Padrões |
| `vision.clutter` | URL e imagem | densidade de bordas na 1ª dobra > 14% | Imagem |
| `vision.crowding` | URL e imagem | blocos cobrem > 88% da 1ª dobra | Imagem |
| `vision.alignment` | imagem | ≥ 3 linhas a 5–10 px de uma âncora com ≥ 4 linhas, formando uma coluna deslocada | OCR, Imagem |
| `vision.hierarchy` | imagem | maior linha < 1,45× a mediana | OCR |
| `vision.cta-competition` | URL e imagem | botões preenchidos em ≥ 3 matizes fortes na 1ª dobra | Padrões, Imagem |
| `vision.button-patterns` | imagem | botões < 32 px em tela ≤ 600 px; ≥ 3 alturas diferentes | Padrões |
| `vision.nav-overload` | imagem | menu reconhecido com > 8 itens (logomarca separada por vão) | OCR, Padrões |
| `vision.component-variants` | URL | componente isolado a ≤ 3 px de raio/≤ 4 px de altura/ΔE < 6 do grupo dominante | Padrões, DOM |
| `vision.dom:*` | URL | fatos do parsing estático (ver tabela de módulos) | DOM |

## Monitor (`monitor.ts`)

| Regra | Efeito |
|---|---|
| M1 | Evidência fora da área capturada → descartada; sem evidência válida → achado rejeitado. |
| M2 | Confiança < 60% → rejeitado; 60–75% → severidade rebaixada um nível. |
| M3 | Contraste por pixels × DOM. Cada linha do OCR é casada com o DOM nas duas direções: elementos contidos na linha (menus que o OCR junta) e o elemento de texto mais interno que contém a linha (parágrafos). Se o DOM aprova, o achado é **rejeitado**, porque o DOM é mais preciso. Se o DOM reprova, ele **corrobora** o problema existente, que passa a exibir "Confirmado por OCR + Imagem". |
| M4 | Mesmo problema já medido pelas regras do DOM (mesma categoria, evidência sobreposta) → **corroboração** em vez de duplicata. |

O relatório (`AnalysisResult.vision`) inclui as estatísticas de cada módulo, as
regras avaliadas e disparadas, as contagens de decisões e o rastro completo, que
é exibido na interface ("Rastro de decisões").

## Imagens importadas

Sem DOM, as regras de visão são a fonte do diagnóstico, e **a análise recebe nota**.
Responsividade é marcada como **não medida**, porque há uma resolução só, e não entra
na nota. A densidade de pixels é estimada pela largura (capturas retina 2×/3×).

## Harmonização por regras (modo "Harmonização completa")

`server/src/redesign/harmonize.ts`, aplicada além das correções pontuais:

- **H1:** variantes acidentais de botões e campos adotam a assinatura dominante.
- **H2:** cores quase iguais (ΔE2000 < 6, com croma) convergem para a mais usada.
- **H3:** famílias tipográficas além das duas principais passam para a família de texto.

O resultado é recapturado e medido de novo, como no modo "Preservar identidade".

## Limitações conhecidas

- O OCR é treinado para texto impresso; fontes muito decorativas, texto rotacionado ou sobre fotos têm leitura pior. Linhas abaixo de 75% de confiança não geram achados.
- A detecção de botões exige superfície retangular de cor uniforme. Botões só com contorno, com gradiente ou colados a outros botões da mesma cor não são reconhecidos.
- A estimativa de densidade de pixels de imagens importadas é heurística. Por isso, achados que dependem de tamanho absoluto têm confiança menor.
- O pipeline adiciona cerca de 2–6 s por análise (OCR de desktop e mobile).
