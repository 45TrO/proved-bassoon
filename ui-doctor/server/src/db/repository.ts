import { randomUUID } from 'node:crypto';
import type {
  AnalysisDetail,
  AnalysisResult,
  AnalysisStatus,
  AnalysisSummary,
  DashboardStats,
  IssueCategory,
  IssueStatus,
  ProgressStep,
  ProjectSummary,
  RedesignMode,
  RedesignStatus,
  RedesignSummary,
  Severity,
} from '../domain/types.js';
import type { Db } from './database.js';

const now = () => new Date().toISOString();

interface ProjectRow {
  id: string;
  name: string;
  source_type: 'url' | 'image';
  target: string;
  target_key: string;
  favorite: number;
  created_at: string;
}

interface AnalysisRow {
  id: string;
  project_id: string;
  source_type: 'url' | 'image';
  target: string;
  status: AnalysisStatus;
  progress: string;
  error: string | null;
  result: string | null;
  overall: number | null;
  ui: number | null;
  ux: number | null;
  issue_count: number;
  thumbnail: string | null;
  created_at: string;
  finished_at: string | null;
}

interface RedesignRow {
  id: string;
  analysis_id: string;
  mode: RedesignMode;
  status: RedesignStatus;
  error: string | null;
  data: string | null;
  created_at: string;
}

/** Chave de deduplicação de projeto: mesmo host + caminho = mesmo projeto. */
export function targetKey(sourceType: 'url' | 'image', target: string): string {
  if (sourceType === 'image') return `image:${target}`;
  try {
    const u = new URL(target);
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return `url:${u.hostname.replace(/^www\./, '')}${u.port ? `:${u.port}` : ''}${p}`;
  } catch {
    return `url:${target}`;
  }
}

export function projectNameFor(sourceType: 'url' | 'image', target: string): string {
  if (sourceType === 'image') return target.replace(/\.[a-z0-9]+$/i, '') || 'Imagem importada';
  try {
    const u = new URL(target);
    const host = u.hostname.replace(/^www\./, '');
    return u.pathname && u.pathname !== '/' ? `${host}${u.pathname.replace(/\/+$/, '')}` : host;
  } catch {
    return target;
  }
}

export class Repository {
  constructor(private readonly db: Db) {}

  // ---------- Projetos ----------
  upsertProject(sourceType: 'url' | 'image', target: string, name?: string): ProjectRow {
    const key = targetKey(sourceType, target);
    const existing = this.db.prepare('SELECT * FROM projects WHERE target_key = ?').get(key) as ProjectRow | undefined;
    if (existing) return existing;
    const row: ProjectRow = {
      id: randomUUID(),
      name: name ?? projectNameFor(sourceType, target),
      source_type: sourceType,
      target,
      target_key: key,
      favorite: 0,
      created_at: now(),
    };
    this.db
      .prepare('INSERT INTO projects (id, name, source_type, target, target_key, favorite, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.source_type, row.target, row.target_key, row.favorite, row.created_at);
    return row;
  }

  updateProject(id: string, patch: { name?: string; favorite?: boolean }): boolean {
    const p = this.db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
    if (!p) return false;
    if (patch.name !== undefined) this.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(patch.name, id);
    if (patch.favorite !== undefined) this.db.prepare('UPDATE projects SET favorite = ? WHERE id = ?').run(patch.favorite ? 1 : 0, id);
    return true;
  }

  deleteProject(id: string): string[] {
    const ids = (this.db.prepare('SELECT id FROM analyses WHERE project_id = ?').all(id) as { id: string }[]).map((r) => r.id);
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return ids;
  }

  private projectSummary(p: ProjectRow): ProjectSummary {
    const analyses = this.db
      .prepare("SELECT id, overall, created_at, thumbnail FROM analyses WHERE project_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 12")
      .all(p.id) as { id: string; overall: number | null; created_at: string; thumbnail: string | null }[];
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM analyses WHERE project_id = ?').get(p.id) as { n: number }).n;
    const last = analyses[0];
    return {
      id: p.id,
      name: p.name,
      sourceType: p.source_type,
      target: p.target,
      favorite: p.favorite === 1,
      createdAt: p.created_at,
      analysisCount: count,
      lastAnalysisId: last?.id ?? null,
      lastOverall: last?.overall ?? null,
      lastAnalyzedAt: last?.created_at ?? null,
      thumbnail: last?.thumbnail ?? null,
      trend: analyses
        .map((a) => a.overall)
        .filter((v): v is number => v !== null)
        .reverse(),
    };
  }

  listProjects(opts: { favorites?: boolean; q?: string } = {}): ProjectSummary[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.favorites) where.push('favorite = 1');
    if (opts.q) {
      where.push('(name LIKE ? OR target LIKE ?)');
      args.push(`%${opts.q}%`, `%${opts.q}%`);
    }
    const sql = `SELECT * FROM projects ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 200`;
    return (this.db.prepare(sql).all(...args) as unknown as ProjectRow[]).map((p) => this.projectSummary(p));
  }

  getProject(id: string): (ProjectSummary & { analyses: AnalysisSummary[] }) | null {
    const p = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!p) return null;
    const rows = this.db.prepare('SELECT * FROM analyses WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').all(id) as unknown as AnalysisRow[];
    return { ...this.projectSummary(p), analyses: rows.map((r) => this.summary(r, p)) };
  }

  // ---------- Análises ----------
  createAnalysis(projectId: string, sourceType: 'url' | 'image', target: string, progress: ProgressStep[]): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO analyses (id, project_id, source_type, target, status, progress, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, projectId, sourceType, target, 'queued', JSON.stringify(progress), now());
    return id;
  }

  setStatus(id: string, status: AnalysisStatus, progress: ProgressStep[]) {
    this.db.prepare('UPDATE analyses SET status = ?, progress = ? WHERE id = ?').run(status, JSON.stringify(progress), id);
  }

  completeAnalysis(id: string, result: AnalysisResult, progress: ProgressStep[], thumbnail: string | null) {
    this.db
      .prepare(
        "UPDATE analyses SET status = 'done', progress = ?, result = ?, overall = ?, ui = ?, ux = ?, issue_count = ?, thumbnail = ?, finished_at = ?, error = NULL WHERE id = ?",
      )
      .run(
        JSON.stringify(progress),
        JSON.stringify(result),
        result.scored ? result.scores.overall : null,
        result.scored ? result.scores.ui : null,
        result.scored ? result.scores.ux : null,
        result.issues.length,
        thumbnail,
        now(),
        id,
      );
  }

  failAnalysis(id: string, error: string, progress: ProgressStep[]) {
    this.db
      .prepare("UPDATE analyses SET status = 'failed', error = ?, progress = ?, finished_at = ? WHERE id = ?")
      .run(error, JSON.stringify(progress), now(), id);
  }

  /** Jobs interrompidos por reinício do servidor viram falha explícita. */
  failInterrupted(): number {
    const r = this.db
      .prepare(
        "UPDATE analyses SET status = 'failed', error = 'Análise interrompida por reinício do servidor. Execute novamente.', finished_at = ? WHERE status NOT IN ('done','failed')",
      )
      .run(now());
    this.db.prepare("UPDATE redesigns SET status = 'failed', error = 'Interrompido por reinício do servidor.' WHERE status NOT IN ('done','failed')").run();
    return Number(r.changes);
  }

  private implementedCount(analysisId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM issue_states WHERE analysis_id = ? AND status = 'implemented'").get(analysisId) as { n: number }).n;
  }

  private summary(r: AnalysisRow, p?: ProjectRow): AnalysisSummary {
    const project = p ?? (this.db.prepare('SELECT * FROM projects WHERE id = ?').get(r.project_id) as ProjectRow | undefined);
    return {
      id: r.id,
      projectId: r.project_id,
      projectName: project?.name ?? '',
      sourceType: r.source_type,
      target: r.target,
      status: r.status,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
      overall: r.overall,
      ui: r.ui,
      ux: r.ux,
      issueCount: r.issue_count,
      implementedCount: this.implementedCount(r.id),
      thumbnail: r.thumbnail,
    };
  }

  listAnalyses(limit = 50): AnalysisSummary[] {
    const rows = this.db.prepare('SELECT * FROM analyses ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as AnalysisRow[];
    return rows.map((r) => this.summary(r));
  }

  getAnalysisRow(id: string): AnalysisRow | null {
    return (this.db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as AnalysisRow | undefined) ?? null;
  }

  getAnalysis(id: string): AnalysisDetail | null {
    const r = this.getAnalysisRow(id);
    if (!r) return null;
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(r.project_id) as ProjectRow | undefined;
    const result = r.result ? (JSON.parse(r.result) as AnalysisResult) : null;
    if (result) {
      const states = this.db.prepare('SELECT issue_id, status FROM issue_states WHERE analysis_id = ?').all(id) as { issue_id: string; status: IssueStatus }[];
      const map = new Map(states.map((s) => [s.issue_id, s.status]));
      for (const issue of result.issues) issue.status = map.get(issue.id) ?? 'open';
    }
    return {
      ...this.summary(r, project),
      progress: JSON.parse(r.progress) as ProgressStep[],
      error: r.error,
      result,
      redesigns: this.listRedesigns(id),
      favorite: project?.favorite === 1,
    };
  }

  deleteAnalysis(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM analyses WHERE id = ?').run(id).changes) > 0;
  }

  setIssueStatus(analysisId: string, issueId: string, status: IssueStatus): boolean {
    const r = this.getAnalysisRow(analysisId);
    if (!r?.result) return false;
    const result = JSON.parse(r.result) as AnalysisResult;
    if (!result.issues.some((i) => i.id === issueId)) return false;
    this.db
      .prepare(
        'INSERT INTO issue_states (analysis_id, issue_id, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(analysis_id, issue_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at',
      )
      .run(analysisId, issueId, status, now());
    return true;
  }

  // ---------- Redesign ----------
  createRedesign(analysisId: string, mode: RedesignMode): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO redesigns (id, analysis_id, mode, status, created_at) VALUES (?, ?, ?, 'queued', ?)").run(id, analysisId, mode, now());
    return id;
  }

  updateRedesign(id: string, status: RedesignStatus, data?: Partial<RedesignSummary>, error?: string) {
    this.db
      .prepare('UPDATE redesigns SET status = ?, data = COALESCE(?, data), error = ? WHERE id = ?')
      .run(status, data ? JSON.stringify(data) : null, error ?? null, id);
  }

  getRedesign(id: string): RedesignSummary | null {
    const r = this.db.prepare('SELECT * FROM redesigns WHERE id = ?').get(id) as RedesignRow | undefined;
    return r ? this.redesignFromRow(r) : null;
  }

  listRedesigns(analysisId: string): RedesignSummary[] {
    const rows = this.db.prepare('SELECT * FROM redesigns WHERE analysis_id = ? ORDER BY created_at DESC').all(analysisId) as unknown as RedesignRow[];
    return rows.map((r) => this.redesignFromRow(r));
  }

  private redesignFromRow(r: RedesignRow): RedesignSummary {
    const data = r.data ? (JSON.parse(r.data) as Partial<RedesignSummary>) : {};
    return {
      id: r.id,
      analysisId: r.analysis_id,
      mode: r.mode,
      status: r.status,
      createdAt: r.created_at,
      error: r.error,
      changes: data.changes ?? [],
      before: data.before ?? [],
      after: data.after ?? [],
      scoresBefore: data.scoresBefore ?? null,
      scoresAfter: data.scoresAfter ?? null,
      issuesBefore: data.issuesBefore ?? null,
      issuesAfter: data.issuesAfter ?? null,
      css: data.css ?? '',
      note: data.note ?? null,
    };
  }

  // ---------- Dashboard ----------
  dashboard(): DashboardStats {
    const projects = (this.db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n;
    const analyses = (this.db.prepare("SELECT COUNT(*) AS n FROM analyses WHERE status = 'done'").get() as { n: number }).n;
    const avg = this.db.prepare("SELECT AVG(ui) AS ui, AVG(ux) AS ux, AVG(overall) AS overall, SUM(issue_count) AS issues FROM analyses WHERE status = 'done'").get() as {
      ui: number | null;
      ux: number | null;
      overall: number | null;
      issues: number | null;
    };
    const implemented = (this.db.prepare("SELECT COUNT(*) AS n FROM issue_states WHERE status = 'implemented'").get() as { n: number }).n;

    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const byCategory: Record<IssueCategory, number> = { visual: 0, ux: 0, accessibility: 0, responsive: 0, identity: 0 };
    const results = this.db.prepare("SELECT result FROM analyses WHERE status = 'done' ORDER BY created_at DESC LIMIT 200").all() as { result: string }[];
    for (const row of results) {
      const r = JSON.parse(row.result) as AnalysisResult;
      for (const i of r.issues) {
        bySeverity[i.severity]++;
        byCategory[i.category]++;
      }
    }
    const timeline = (
      this.db
        .prepare(
          "SELECT substr(created_at, 1, 10) AS date, AVG(ui) AS ui, AVG(ux) AS ux, AVG(overall) AS overall, COUNT(*) AS n FROM analyses WHERE status = 'done' GROUP BY date ORDER BY date DESC LIMIT 30",
        )
        .all() as { date: string; ui: number; ux: number; overall: number; n: number }[]
    )
      .reverse()
      .map((t) => ({ date: t.date, ui: Math.round(t.ui), ux: Math.round(t.ux), overall: Math.round(t.overall), analyses: t.n }));

    const round = (v: number | null) => (v === null ? null : Math.round(v));
    return {
      projects,
      analyses,
      avgUi: round(avg.ui),
      avgUx: round(avg.ux),
      avgOverall: round(avg.overall),
      issuesFound: avg.issues ?? 0,
      issuesImplemented: implemented,
      bySeverity,
      byCategory,
      timeline,
      recent: this.listAnalyses(8),
      favorites: this.listProjects({ favorites: true }).slice(0, 8),
    };
  }
}
