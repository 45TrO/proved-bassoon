import { describe, expect, it } from 'vitest';
import type { Issue, RedesignChange } from '@shared/types';
import { validateImageFile } from '../components/analysis/AnalyzeForm';
import { groupChanges } from '../components/analysis/BeforeAfter';
import { filterIssues } from '../components/analysis/IssueList';
import { relativeTime, scoreTone, validateUrlInput } from '../lib/format';

describe('validateUrlInput', () => {
  it.each([
    ['', /Informe/],
    ['   ', /Informe/],
    ['meu site.com', /espaços/],
    ['ftp://exemplo.com', /http/],
    ['javascript:alert(1)', /http/],
    ['intranet', /domínio completo/],
  ])('recusa %j', (input, msg) => {
    expect(validateUrlInput(input)).toMatch(msg);
  });

  it.each(['exemplo.com.br', 'https://exemplo.com/loja?x=1', 'http://sub.exemplo.io:8080/a'])('aceita %s', (input) => {
    expect(validateUrlInput(input)).toBeNull();
  });
});

describe('validateImageFile', () => {
  const file = (type: string, size: number) => new File([new Uint8Array(size)], 'x', { type });
  it('aceita PNG/JPEG/WebP até 10 MB', () => {
    expect(validateImageFile(file('image/png', 1000))).toBeNull();
    expect(validateImageFile(file('image/webp', 1000))).toBeNull();
  });
  it('recusa outros tipos, vazios e grandes demais', () => {
    expect(validateImageFile(file('image/svg+xml', 10))).toMatch(/Formato/);
    expect(validateImageFile(file('image/png', 0))).toMatch(/vazio/);
    expect(validateImageFile(file('image/jpeg', 11 * 1024 * 1024))).toMatch(/10 MB/);
  });
});

const mk = (id: string, over: Partial<Issue> = {}): Issue => ({
  id,
  ruleId: id,
  source: 'rules',
  category: 'visual',
  severity: 'medium',
  title: id,
  description: '',
  recommendation: '',
  evidence: [],
  occurrences: 1,
  fixable: false,
  ...over,
});

describe('filterIssues', () => {
  const issues = [mk('a'), mk('b', { category: 'ux', severity: 'high' }), mk('c', { status: 'implemented' })];
  it('oculta resolvidos por padrão e filtra por categoria e severidade', () => {
    expect(filterIssues(issues, { category: 'all', severity: 'all', showClosed: false }).map((i) => i.id)).toEqual(['a', 'b']);
    expect(filterIssues(issues, { category: 'ux', severity: 'all', showClosed: false }).map((i) => i.id)).toEqual(['b']);
    expect(filterIssues(issues, { category: 'all', severity: 'high', showClosed: false }).map((i) => i.id)).toEqual(['b']);
    expect(filterIssues(issues, { category: 'all', severity: 'all', showClosed: true })).toHaveLength(3);
  });
});

describe('groupChanges', () => {
  it('agrupa por título mantendo a ordem', () => {
    const c = (id: string, title: string): RedesignChange => ({ id, title, detail: '', selector: 's', css: '', source: 'rules' });
    expect(groupChanges([c('1', 'A'), c('2', 'B'), c('3', 'A')]).map(([t, xs]) => [t, xs.length])).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
  });
});

describe('formatação', () => {
  it('faixas de nota', () => {
    expect(scoreTone(90)).toBe('good');
    expect(scoreTone(70)).toBe('fair');
    expect(scoreTone(30)).toBe('poor');
    expect(scoreTone(null)).toBe('none');
  });
  it('tempo relativo', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    expect(relativeTime('2026-11-18T11:59:50Z', now)).toBe('agora');
    expect(relativeTime('2026-11-18T10:00:00Z', now)).toBe('há 2 horas');
  });
});
