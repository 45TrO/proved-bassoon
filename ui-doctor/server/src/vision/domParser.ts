import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

/**
 * Parsing estático do HTML renderizado (parse5, conforme a especificação HTML).
 * Extrai fatos que o snapshot visual não captura: metadados, atributos,
 * marcação obsoleta e padrões de código que afetam UX e acessibilidade.
 */
export interface DomFacts {
  title: string | null;
  metaDescription: string | null;
  deprecatedTags: Record<string, number>;
  inlineStyles: number;
  elements: number;
  positiveTabindex: string[];
  iframesWithoutTitle: number;
  autoplayMedia: number;
  blankTargetsWithoutRel: number;
  imagesWithoutDimensions: number;
  images: number;
  emptyLinks: number;
  emptyHeadings: number;
  layoutTables: number;
  clickableDivs: number;
}

const DEPRECATED = new Set(['font', 'center', 'marquee', 'blink', 'big', 'strike', 'tt', 'frame', 'frameset', 'acronym']);

function attr(el: Element, name: string): string | null {
  return el.attrs.find((a) => a.name === name)?.value ?? null;
}

function textContent(node: Node): string {
  if (node.nodeName === '#text') return (node as DefaultTreeAdapterMap['textNode']).value;
  if ('childNodes' in node) return node.childNodes.map(textContent).join('');
  return '';
}

function walk(node: Node, visit: (el: Element) => void) {
  if ('tagName' in node) visit(node as Element);
  if ('childNodes' in node) for (const c of node.childNodes) walk(c, visit);
  if (node.nodeName === 'template' && 'content' in node) walk((node as DefaultTreeAdapterMap['template']).content, visit);
}

export function parseDom(html: string): DomFacts {
  const doc = parse(html.slice(0, 5_000_000));
  const facts: DomFacts = {
    title: null,
    metaDescription: null,
    deprecatedTags: {},
    inlineStyles: 0,
    elements: 0,
    positiveTabindex: [],
    iframesWithoutTitle: 0,
    autoplayMedia: 0,
    blankTargetsWithoutRel: 0,
    imagesWithoutDimensions: 0,
    images: 0,
    emptyLinks: 0,
    emptyHeadings: 0,
    layoutTables: 0,
    clickableDivs: 0,
  };
  walk(doc, (el) => {
    facts.elements++;
    const tag = el.tagName;
    if (DEPRECATED.has(tag)) facts.deprecatedTags[tag] = (facts.deprecatedTags[tag] ?? 0) + 1;
    if (attr(el, 'style')) facts.inlineStyles++;
    const tab = attr(el, 'tabindex');
    if (tab && Number(tab) > 0) facts.positiveTabindex.push(`<${tag} tabindex="${tab}">`);
    switch (tag) {
      case 'title':
        facts.title ??= textContent(el).trim() || null;
        break;
      case 'meta':
        if (attr(el, 'name')?.toLowerCase() === 'description') facts.metaDescription = attr(el, 'content')?.trim() || null;
        break;
      case 'iframe':
        if (!attr(el, 'title')?.trim()) facts.iframesWithoutTitle++;
        break;
      case 'video':
      case 'audio':
        if (attr(el, 'autoplay') !== null && attr(el, 'muted') === null) facts.autoplayMedia++;
        break;
      case 'a': {
        if (attr(el, 'target') === '_blank' && !/noopener|noreferrer/.test(attr(el, 'rel') ?? '')) facts.blankTargetsWithoutRel++;
        const hasImgAlt = el.childNodes.some((c) => 'tagName' in c && (c as Element).tagName === 'img' && (attr(c as Element, 'alt') ?? '').trim());
        if (attr(el, 'href') !== null && !textContent(el).trim() && !attr(el, 'aria-label') && !attr(el, 'title') && !hasImgAlt && !el.childNodes.some((c) => 'tagName' in c && (c as Element).tagName === 'svg')) {
          facts.emptyLinks++;
        }
        break;
      }
      case 'img':
        facts.images++;
        if (attr(el, 'width') === null || attr(el, 'height') === null) facts.imagesWithoutDimensions++;
        break;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        if (!textContent(el).trim()) facts.emptyHeadings++;
        break;
      case 'table': {
        const hasHeaders = (n: Node): boolean => ('tagName' in n && ((n as Element).tagName === 'th' || (n as Element).tagName === 'caption')) || ('childNodes' in n && n.childNodes.some(hasHeaders));
        if (attr(el, 'role') === 'presentation' || !hasHeaders(el)) facts.layoutTables++;
        break;
      }
      case 'div':
      case 'span':
        if (attr(el, 'onclick') !== null && !attr(el, 'role') && attr(el, 'tabindex') === null) facts.clickableDivs++;
        break;
      default:
        break;
    }
  });
  return facts;
}
