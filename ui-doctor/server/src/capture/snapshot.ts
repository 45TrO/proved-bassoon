/** Estrutura serializável produzida pelo coletor dentro da página. */

export type ElementKind =
  | 'button'
  | 'link'
  | 'input'
  | 'select'
  | 'textarea'
  | 'img'
  | 'heading'
  | 'text'
  | 'container'
  | 'media'
  | 'other';

export interface SnapEl {
  i: number;
  parent: number;
  depth: number;
  tag: string;
  kind: ElementKind;
  selector: string;
  role: string | null;
  /** Coordenadas na página (scroll considerado). */
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  ownText: boolean;
  words: number;
  color: string;
  bg: string;
  /** background-color do próprio elemento (pode ser transparente). */
  ownBg: string;
  bgImage: boolean;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  lineHeight: number;
  display: string;
  position: string;
  margin: [number, number, number, number];
  padding: [number, number, number, number];
  radius: number;
  borderWidth: number;
  borderColor: string;
  textAlign: string;
  interactive: boolean;
  name: string;
  headingLevel: number | null;
  imgAlt: string | null;
  imgNaturalW: number;
  imgNaturalH: number;
  /** Imagem vetorial (SVG): não perde nitidez nem distorce por padrão. */
  imgVector: boolean;
  objectFit: string;
  inputType: string | null;
  hasLabel: boolean;
  placeholder: string | null;
  autocomplete: string | null;
  required: boolean;
  overflowRight: number;
  clippedByAncestor: boolean;
  textCut: boolean;
  hidden: boolean;
  focusOutlineNone: boolean;
}

export interface SnapForm {
  selector: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fields: number;
  required: number;
  unlabeled: number;
  hasSubmit: boolean;
}

export interface Snapshot {
  viewport: { width: number; height: number };
  url: string;
  title: string;
  lang: string | null;
  metaViewport: string | null;
  docWidth: number;
  docHeight: number;
  clientWidth: number;
  elements: SnapEl[];
  truncated: boolean;
  forms: SnapForm[];
  landmarks: { nav: number; main: number; header: number; footer: number };
  navLinksVisible: number;
  navToggle: boolean;
  navOverflow: boolean;
  duplicateIds: string[];
  skipLink: boolean;
  pageBg: string;
}
