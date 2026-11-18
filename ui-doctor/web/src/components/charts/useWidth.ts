import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Largura do contêiner, medida antes do primeiro paint (useLayoutEffect) e
 * atualizada por ResizeObserver. Evita que gráficos nasçam mais largos que a tela.
 */
export function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number) => setWidth(Math.max(200, Math.floor(w)));
    measure(el.getBoundingClientRect().width || fallback);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => entry && measure(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}
