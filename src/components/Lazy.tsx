import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ErrorState, Skeleton } from './States';

/**
 * Load a component only when it is first shown, so the chart and map libraries stay out of the
 * first page load.
 */
export function Lazy<P extends object>({
  load,
  props,
  height,
}: {
  load: () => Promise<{ default: ComponentType<P> }>;
  props: P;
  height: number;
}) {
  const [Comp, setComp] = useState<ComponentType<P> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    load().then(
      (m) => alive && setComp(() => m.default),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  if (failed) return <ErrorState onRetry={() => setAttempt((n) => n + 1)} />;
  if (!Comp) return <Skeleton h={height} />;
  return <Comp {...props} />;
}

export const loadForecastChart = () => import('./charts/ForecastChart');
export const loadSeriesChart = () => import('./charts/SeriesChart');
