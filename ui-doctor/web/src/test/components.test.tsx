import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Issue } from '@shared/types';
import { AnalyzeForm } from '../components/analysis/AnalyzeForm';
import { IssueList } from '../components/analysis/IssueList';
import { ScoreRing } from '../components/ui/ScoreRing';
import { SeverityBadge } from '../components/ui/SeverityBadge';

const navigate = vi.fn();
vi.mock('react-router', async (orig) => ({ ...(await orig<typeof import('react-router')>()), useNavigate: () => navigate }));

describe('AnalyzeForm', () => {
  it('mostra erro de validação sem chamar a API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<AnalyzeForm />, { wrapper: MemoryRouter });
    await userEvent.type(screen.getByLabelText('Endereço da página'), 'intranet');
    await userEvent.click(screen.getByRole('button', { name: 'Analisar interface' }));
    expect(screen.getByRole('alert')).toHaveTextContent('domínio completo');
    expect(screen.getByLabelText('Endereço da página')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('envia a URL e navega para a análise', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'abc' }), { status: 202 }));
    render(<AnalyzeForm />, { wrapper: MemoryRouter });
    await userEvent.type(screen.getByLabelText('Endereço da página'), 'exemplo.com.br');
    await userEvent.click(screen.getByRole('button', { name: 'Analisar interface' }));
    expect(fetchSpy).toHaveBeenCalledWith('/api/analyses', expect.objectContaining({ method: 'POST', body: JSON.stringify({ url: 'exemplo.com.br' }) }));
    expect(navigate).toHaveBeenCalledWith('/analises/abc');
    fetchSpy.mockRestore();
  });

  it('exibe a mensagem de erro do servidor (ex.: rede interna bloqueada)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: { code: 'private_address', message: 'Endereços IP privados ou reservados não podem ser analisados.' } }), { status: 422 }));
    render(<AnalyzeForm />, { wrapper: MemoryRouter });
    await userEvent.type(screen.getByLabelText('Endereço da página'), 'http://10.0.0.1');
    await userEvent.click(screen.getByRole('button', { name: 'Analisar interface' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('privados ou reservados');
    fetchSpy.mockRestore();
  });
});

describe('IssueList', () => {
  const issues: Issue[] = [
    {
      id: 'a11y.contrast',
      ruleId: 'a11y.contrast',
      source: 'rules',
      category: 'accessibility',
      severity: 'high',
      title: 'Texto com contraste insuficiente',
      description: 'desc',
      recommendation: 'Ajuste a cor.',
      evidence: [{ viewport: 'desktop', selector: 'p.muted', snippet: 'Olá', measured: { ratio: 2.1, required: 4.5, foreground: '#aaaaaa' } }],
      occurrences: 1,
      fixable: true,
    },
    { id: 'v', ruleId: 'v', source: 'ai', category: 'visual', severity: 'low', title: 'Título fraco', description: '', recommendation: '', evidence: [], occurrences: 1, fixable: false },
  ];

  it('filtra por categoria e mostra evidências medidas ao selecionar', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<IssueList issues={issues} selectedId={null} onSelect={onSelect} onStatus={vi.fn()} />);
    await userEvent.click(within(screen.getByRole('group', { name: 'Filtrar por categoria' })).getByRole('button', { name: /Acessibilidade/ }));
    expect(screen.queryByText('Título fraco')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Texto com contraste/ }));
    expect(onSelect).toHaveBeenCalledWith('a11y.contrast');
    rerender(<IssueList issues={issues} selectedId="a11y.contrast" onSelect={onSelect} onStatus={vi.fn()} />);
    expect(screen.getByText('2.1:1')).toBeInTheDocument();
    expect(screen.getByText('p.muted')).toBeInTheDocument();
  });

  it('marca como corrigido', async () => {
    const onStatus = vi.fn().mockResolvedValue(undefined);
    render(<IssueList issues={issues} selectedId="a11y.contrast" onSelect={vi.fn()} onStatus={onStatus} />);
    await userEvent.click(screen.getByRole('button', { name: /Marcar como corrigido/ }));
    expect(onStatus).toHaveBeenCalledWith(issues[0], 'implemented');
  });
});

describe('indicadores', () => {
  it('ScoreRing expõe a nota para tecnologias assistivas', () => {
    render(<ScoreRing value={72} label="Nota geral" />);
    expect(screen.getByRole('img', { name: 'Nota geral: 72 de 100' })).toBeInTheDocument();
  });
  it('SeverityBadge comunica severidade por texto, não só por cor', () => {
    render(<SeverityBadge severity="critical" />);
    expect(within(document.body).getByText('Crítica')).toBeInTheDocument();
  });
});
