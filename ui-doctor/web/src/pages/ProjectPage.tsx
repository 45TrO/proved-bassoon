import { Pencil, Star, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Sparkline } from '../components/charts/Bars';
import { PageHeader } from '../components/layout/AppShell';
import { Button } from '../components/ui/Button';
import { ConfirmButton } from '../components/ui/ConfirmButton';
import { EmptyState, ErrorNotice, Skeleton } from '../components/ui/Empty';
import { useToast } from '../components/ui/Toast';
import { api, ApiError } from '../lib/api';
import { useAsync, useDocumentTitle } from '../lib/hooks';
import { AnalysisThumb } from './HomePage';

export function ProjectPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const q = useAsync(() => api.project(id), [id]);
  const p = q.data;
  useDocumentTitle(p?.name ?? 'Projeto');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  if (q.loading && !p) return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8"><Skeleton className="h-64" /></div>;
  if (q.error && !p) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title="Projeto não encontrado">Ele pode ter sido excluído.</EmptyState> : <ErrorNotice error={q.error} onRetry={q.reload} />}
      </div>
    );
  }
  if (!p) return null;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return setNameError('O nome não pode ficar vazio.');
    if (v.length > 120) return setNameError('Use no máximo 120 caracteres.');
    try {
      await api.updateProject(p.id, { name: v });
      q.setData((prev) => (prev ? { ...prev, name: v } : prev));
      setEditing(false);
      toast('Nome atualizado');
    } catch (err) {
      setNameError((err as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      {editing ? (
        <form onSubmit={saveName} className="mb-6 flex flex-wrap items-start gap-2" noValidate>
          <div>
            <label htmlFor="nome" className="sr-only">Nome do projeto</label>
            <input id="nome" autoFocus value={name} onChange={(e) => { setName(e.target.value); setNameError(null); }} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? 'nome-erro' : undefined} className="h-10 w-72 max-w-full rounded-lg border border-line bg-surface px-3 text-lg font-semibold outline-none focus:border-inspect" />
            {nameError && <p id="nome-erro" role="alert" className="mt-1 text-sm text-critical">{nameError}</p>}
          </div>
          <Button type="submit" variant="primary">Salvar nome</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
        </form>
      ) : (
        <PageHeader
          title={p.name}
          description={p.sourceType === 'url' ? p.target : 'Captura de tela importada'}
          actions={
            <>
              <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => { setName(p.name); setEditing(true); }}>Renomear</Button>
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={p.favorite}
                icon={<Star size={14} className={p.favorite ? 'fill-current text-medium' : ''} />}
                onClick={async () => {
                  try {
                    await api.updateProject(p.id, { favorite: !p.favorite });
                    q.setData((prev) => (prev ? { ...prev, favorite: !prev.favorite } : prev));
                  } catch (err) {
                    toast((err as Error).message, 'error');
                  }
                }}
              >
                {p.favorite ? 'Favorito' : 'Favoritar'}
              </Button>
              <ConfirmButton
                size="sm"
                variant="ghost"
                icon={<Trash2 size={14} />}
                confirmLabel="Excluir projeto e análises"
                onConfirm={async () => {
                  try {
                    await api.deleteProject(p.id);
                    toast('Projeto excluído');
                    navigate('/projetos');
                  } catch (err) {
                    toast((err as Error).message, 'error');
                  }
                }}
              >
                Excluir
              </ConfirmButton>
            </>
          }
        />
      )}
      {p.trend.length > 1 && (
        <div className="mb-8 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <Sparkline values={p.trend} width={120} height={28} />
          <span className="text-muted">
            Nota geral foi de <span className="tabular font-medium text-ink">{p.trend[0]}</span> para <span className="tabular font-medium text-ink">{p.trend[p.trend.length - 1]}</span> nas últimas {p.trend.length} análises.
          </span>
        </div>
      )}
      <h2 className="mb-4 text-[15px] font-semibold">Histórico de análises</h2>
      {p.analyses.length === 0 ? (
        <p className="text-sm text-muted">Sem análises. <Link to="/" className="text-inspect hover:underline">Fazer uma análise</Link></p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {p.analyses.map((a) => <AnalysisThumb key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}
