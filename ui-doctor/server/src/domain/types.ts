/**
 * Tipos de domínio compartilhados entre servidor e frontend.
 * Este arquivo não pode importar nada específico de Node.
 */

export type ViewportName = 'desktop' | 'tablet' | 'mobile';

export interface ViewportSpec {
  name: ViewportName;
  width: number;
  height: number;
  label: string;
}

export const VIEWPORTS: readonly ViewportSpec[] = [
  { name: 'desktop', width: 1440, height: 900, label: 'Desktop · 1440' },
  { name: 'tablet', width: 834, height: 1112, label: 'Tablet · 834' },
  { name: 'mobile', width: 390, height: 844, label: 'Mobile · 390' },
] as const;

export type IssueCategory = 'visual' | 'ux' | 'accessibility' | 'responsive' | 'identity';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type IssueSource = 'rules' | 'ai';
export type IssueStatus = 'open' | 'implemented' | 'dismissed';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Evidence {
  viewport: ViewportName | 'image';
  /** Seletor CSS do elemento real (quando houver DOM). */
  selector?: string;
  /** Região na captura de tela, em pixels CSS da página. */
  rect?: Rect;
  /** Trecho de texto do elemento, para identificação humana. */
  snippet?: string;
  /** Valores medidos que dispararam o diagnóstico. */
  measured: Record<string, string | number | boolean>;
}

export interface Issue {
  id: string;
  ruleId: string;
  source: IssueSource;
  category: IssueCategory;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  evidence: Evidence[];
  /** Quantas ocorrências a regra encontrou (evidence pode estar truncada). */
  occurrences: number;
  /** Correção CSS automática aplicável no modo "antes e depois". */
  fixable: boolean;
  status?: IssueStatus;
}

export interface Scores {
  overall: number;
  ui: number;
  ux: number;
  categories: Record<IssueCategory, number>;
}

export interface PaletteColor {
  hex: string;
  /** Fração da área visível coberta por essa cor (0..1). */
  share: number;
  role: 'background' | 'text' | 'accent' | 'border';
}

export interface TypographyEntry {
  family: string;
  sizes: number[];
  weights: number[];
  usage: number;
}

export interface ContrastPair {
  foreground: string;
  background: string;
  ratio: number;
  passesAA: boolean;
  sample?: string;
  selector?: string;
}

export interface SuggestedPalette {
  name: string;
  rationale: string;
  colors: { hex: string; role: string; onColor: string; contrast: number }[];
}

export interface IdentityReport {
  palette: PaletteColor[];
  typography: TypographyEntry[];
  contrastPairs: ContrastPair[];
  suggestions: SuggestedPalette[];
  nearDuplicateColors: { a: string; b: string; deltaE: number }[];
  typeScale: number[];
}

export interface Capture {
  viewport: ViewportName | 'image';
  width: number;
  height: number;
  /** Altura total capturada (página inteira, limitada). */
  fullHeight: number;
  file: string;
  /** Altura real da página antes do corte. */
  documentHeight?: number;
}

export interface AnalysisMetrics {
  elementsAnalyzed: number;
  interactiveElements: number;
  forms: number;
  images: number;
  wordsAboveFold: number;
  durationMs: number;
}

export type AnalysisStatus = 'queued' | 'capturing' | 'analyzing' | 'scoring' | 'done' | 'failed';

export interface ProgressStep {
  key: string;
  label: string;
  state: 'pending' | 'active' | 'done' | 'skipped' | 'error';
  detail?: string;
}

export interface AnalysisResult {
  /** false quando não há dados suficientes para pontuar (ex.: imagem sem IA). */
  scored: boolean;
  scores: Scores;
  issues: Issue[];
  captures: Capture[];
  identity: IdentityReport;
  metrics: AnalysisMetrics;
  ai: { enabled: boolean; used: boolean; model?: string; note?: string; rejected?: number };
  page: { title: string; finalUrl: string; lang: string | null };
  limitations: string[];
}

export interface AnalysisSummary {
  id: string;
  projectId: string;
  projectName: string;
  sourceType: 'url' | 'image';
  target: string;
  status: AnalysisStatus;
  createdAt: string;
  finishedAt: string | null;
  overall: number | null;
  ui: number | null;
  ux: number | null;
  issueCount: number;
  implementedCount: number;
  thumbnail: string | null;
}

export interface AnalysisDetail extends AnalysisSummary {
  progress: ProgressStep[];
  error: string | null;
  result: AnalysisResult | null;
  redesigns: RedesignSummary[];
  favorite: boolean;
}

export type RedesignMode = 'preserve' | 'full';
export type RedesignStatus = 'queued' | 'running' | 'done' | 'failed';

export interface RedesignChange {
  id: string;
  issueId?: string;
  title: string;
  detail: string;
  selector: string;
  css: string;
  source: IssueSource;
}

export interface RedesignSummary {
  id: string;
  analysisId: string;
  mode: RedesignMode;
  status: RedesignStatus;
  createdAt: string;
  error: string | null;
  changes: RedesignChange[];
  before: Capture[];
  after: Capture[];
  scoresBefore: Scores | null;
  scoresAfter: Scores | null;
  issuesBefore: number | null;
  issuesAfter: number | null;
  css: string;
  note: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  sourceType: 'url' | 'image';
  target: string;
  favorite: boolean;
  createdAt: string;
  analysisCount: number;
  lastAnalysisId: string | null;
  lastOverall: number | null;
  lastAnalyzedAt: string | null;
  thumbnail: string | null;
  trend: number[];
}

export interface DashboardStats {
  projects: number;
  analyses: number;
  avgUi: number | null;
  avgUx: number | null;
  avgOverall: number | null;
  issuesFound: number;
  issuesImplemented: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<IssueCategory, number>;
  timeline: { date: string; ui: number; ux: number; overall: number; analyses: number }[];
  recent: AnalysisSummary[];
  favorites: ProjectSummary[];
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  ai: { enabled: boolean; model: string | null };
  browser: boolean;
}

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  visual: 'Visual',
  ux: 'Experiência',
  accessibility: 'Acessibilidade',
  responsive: 'Responsividade',
  identity: 'Identidade visual',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};
