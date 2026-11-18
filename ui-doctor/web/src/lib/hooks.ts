import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
  setData: (fn: (prev: T | null) => T | null) => void;
}

/** Carrega dados e, opcionalmente, repete a cada `interval` ms enquanto `shouldPoll` for verdadeiro. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[], opts: { interval?: number; shouldPoll?: (d: T) => boolean } = {}): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (first: boolean) => {
      if (first) setLoading(true);
      try {
        const d = await loadRef.current();
        if (cancelled) return;
        setDataState(d);
        setError(null);
        const { interval, shouldPoll } = optsRef.current;
        if (interval && shouldPoll?.(d)) timer = setTimeout(() => void run(false), interval);
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled && first) setLoading(false);
      }
    };
    void run(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((fn: (prev: T | null) => T | null) => setDataState(fn), []);
  return { data, error, loading, reload, setData };
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · UI Doctor` : 'UI Doctor';
  }, [title]);
}
