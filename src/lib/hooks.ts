import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

export interface Async<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Load data with `fn`, again whenever `deps` change, and every `refreshMs` while the tab is visible.
 * During a background refresh the previous data stays on screen.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], refreshMs?: number): Async<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef.current().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error: Error) => alive && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => {
    if (!refreshMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    }, refreshMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshMs]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

/** Current time, updated every 30 s, so "x minutes ago" and staleness stay correct while a page is open. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Re-render when a subscribable value changes. */
export function useSubscription(subscribe: (fn: () => void) => () => void): void {
  const [, set] = useState(0);
  useEffect(() => subscribe(() => set((n) => n + 1)), [subscribe]);
}
