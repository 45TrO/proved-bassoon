import { useEffect, useState } from 'react';
import { Button, type ButtonProps } from './Button';

/** Ação destrutiva em dois cliques: o primeiro arma, o segundo confirma. */
export function ConfirmButton({ onConfirm, children, confirmLabel = 'Confirmar exclusão', ...rest }: ButtonProps & { onConfirm: () => void; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button {...rest} variant={armed ? 'danger' : rest.variant} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirmLabel : children}
    </Button>
  );
}
