import { Link } from 'react-router';
import { EmptyState } from '../components/ui/Empty';
import { useDocumentTitle } from '../lib/hooks';

export function NotFoundPage() {
  useDocumentTitle('Página não encontrada');
  return (
    <div className="px-4 py-24">
      <EmptyState title="Esta página não existe" action={<Link to="/" className="tap text-sm font-medium text-inspect hover:underline">Voltar para o início</Link>}>
        Confira o endereço ou volte para o início.
      </EmptyState>
    </div>
  );
}
