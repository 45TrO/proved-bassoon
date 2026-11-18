import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Check, CircleAlert } from 'lucide-react';

interface ToastItem {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

const Ctx = createContext<(message: string, tone?: ToastItem['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastItem['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3600);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div key={t.id} className="animate-rise pointer-events-auto flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm shadow-pop">
            {t.tone === 'success' ? <Check size={16} className="text-ok" /> : <CircleAlert size={16} className="text-critical" />}
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
