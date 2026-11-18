/**
 * Sanitizador de CSS para código gerado (IA ou regras) antes de ser injetado
 * na página de captura. Remove qualquer construção capaz de iniciar requisições
 * de rede ou executar código.
 */
const FORBIDDEN = [
  /@import\b/gi,
  /@font-face\s*\{[^}]*\}/gi,
  /@namespace\b[^;]*;/gi,
  /url\s*\(/gi,
  /image-set\s*\(/gi,
  /expression\s*\(/gi,
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /behavior\s*:/gi,
  /-moz-binding/gi,
  /<\/?\s*style/gi,
  /<\/?\s*script/gi,
];

export interface SanitizeResult {
  css: string;
  removed: number;
}

export function sanitizeCss(input: string, maxLength = 60_000): SanitizeResult {
  let css = input.slice(0, maxLength);
  let removed = 0;
  // Comentários podem esconder construções proibidas ("u/**/rl(").
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Escapes CSS (\75 rl) podem esconder palavras-chave: a linha inteira é descartada.
  css = css
    .split('\n')
    .filter((line) => {
      if (/\\[0-9a-f]{1,6}/i.test(line)) {
        removed++;
        return false;
      }
      return true;
    })
    .join('\n');
  for (const pattern of FORBIDDEN) {
    css = css.replace(pattern, () => {
      removed++;
      return '/*bloqueado*/(';
    });
  }
  // Declarações que ficaram inválidas após a remoção são descartadas por linha.
  css = css
    .split('\n')
    .filter((line) => !line.includes('/*bloqueado*/'))
    .join('\n');
  // Chaves desbalanceadas podem "vazar" regras; fecha o que ficou aberto.
  const open = (css.match(/\{/g) ?? []).length;
  const close = (css.match(/\}/g) ?? []).length;
  if (open > close) css += '}'.repeat(open - close);
  return { css: css.trim(), removed };
}

/** Valida que um seletor é sintaticamente simples e seguro para compor CSS. */
export function safeSelector(selector: string): boolean {
  return selector.length > 0 && selector.length < 400 && !/[{}<;@\\]/.test(selector);
}
