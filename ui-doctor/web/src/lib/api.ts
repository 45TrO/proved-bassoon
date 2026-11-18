import type {
  AnalysisDetail,
  AnalysisSummary,
  DashboardStats,
  HealthInfo,
  IssueStatus,
  ProjectSummary,
  RedesignMode,
  RedesignSummary,
} from '@shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor do UI Doctor. Verifique se ele está em execução.', 0, 'network');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(err?.message ?? `Erro ${res.status}`, res.status, err?.code ?? 'http');
  }
  return body as T;
}

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  dashboard: () => request<DashboardStats>('/api/dashboard'),
  analyses: (limit = 50) => request<AnalysisSummary[]>(`/api/analyses?limit=${limit}`),
  analysis: (id: string) => request<AnalysisDetail>(`/api/analyses/${id}`),
  analyzeUrl: (url: string) => request<{ id: string }>('/api/analyses', { method: 'POST', body: JSON.stringify({ url }) }),
  analyzeImage: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ id: string }>('/api/analyses/image', { method: 'POST', body: form });
  },
  deleteAnalysis: (id: string) => request<void>(`/api/analyses/${id}`, { method: 'DELETE' }),
  setIssueStatus: (id: string, issueId: string, status: IssueStatus) =>
    request<{ ok: true }>(`/api/analyses/${id}/issues/${encodeURIComponent(issueId)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createRedesign: (id: string, mode: RedesignMode) =>
    request<{ id: string }>(`/api/analyses/${id}/redesigns`, { method: 'POST', body: JSON.stringify({ mode }) }),
  redesign: (id: string) => request<RedesignSummary>(`/api/redesigns/${id}`),
  projects: (opts: { favorites?: boolean; q?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.favorites) p.set('favorites', '1');
    if (opts.q) p.set('q', opts.q);
    const qs = p.toString();
    return request<ProjectSummary[]>(`/api/projects${qs ? `?${qs}` : ''}`);
  },
  project: (id: string) => request<ProjectSummary & { analyses: AnalysisSummary[] }>(`/api/projects/${id}`),
  updateProject: (id: string, patch: { name?: string; favorite?: boolean }) =>
    request<{ ok: true }>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
};

export function fileUrl(analysisId: string, file: string): string {
  return `/api/files/${analysisId}/${encodeURIComponent(file)}`;
}
