import { clsx } from 'clsx';
import { FolderKanban, LayoutDashboard, Menu, Moon, ScanSearch, Sparkles, Sun, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useTheme } from '../../lib/theme';
import { LogoMark } from './Logo';

const NAV = [
  { to: '/', label: 'Nova análise', icon: ScanSearch, end: true },
  { to: '/painel', label: 'Painel', icon: LayoutDashboard, end: false },
  { to: '/projetos', label: 'Projetos', icon: FolderKanban, end: false },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [theme, toggle] = useTheme();
  const health = useAsync(() => api.health(), []);
  const ai = health.data?.ai;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <LogoMark />
        <span className="text-[15px] font-semibold tracking-tight">UI Doctor</span>
      </div>
      <nav aria-label="Principal" className="mt-2 flex flex-col gap-0.5 px-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
                isActive ? 'bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-muted hover:bg-surface-2 hover:text-ink',
              )
            }
          >
            <Icon size={16} strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto space-y-1 p-2">
        <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-xs text-muted">
          <Sparkles size={14} className={clsx('mt-px shrink-0', ai?.enabled ? 'text-inspect' : 'text-faint')} />
          <span>
            {health.loading ? 'Verificando IA…' : ai?.enabled ? 'Revisão por IA ativa' : 'IA desativada: análise apenas por regras medidas'}
          </span>
        </div>
        <button onClick={toggle} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink">
          {theme === 'dark' ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
          {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Pular para o conteúdo
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r border-line lg:block">
        <Sidebar />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-paper/85 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight">UI Doctor</span>
        </div>
        <button onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open} aria-controls="menu-mobile" className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2">
          <Menu size={20} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Fechar menu" className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div id="menu-mobile" className="animate-rise absolute inset-y-0 left-0 w-72 border-r border-line bg-paper shadow-pop">
            <button onClick={() => setOpen(false)} aria-label="Fechar menu" className="absolute top-2 right-2 grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2">
              <X size={18} />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main id="conteudo" className="min-w-0">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
