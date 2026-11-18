import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try {
        localStorage.setItem('uidoctor-theme', next);
      } catch {
        /* armazenamento indisponível: o tema vale só para esta sessão */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}
