import { useEffect, useRef, useState } from 'preact/hooks';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { getLang } from '../../lib/i18n';
import { onThemeChange, token } from '../../lib/theme';

export interface ChartColors {
  text: string;
  muted: string;
  grid: string;
  rain: string;
  prob: string;
  level: string;
  now: string;
  stale: string;
  dangerFill: string;
  danger: string;
  surface: string;
}

export function chartColors(): ChartColors {
  return {
    text: token('--text'),
    muted: token('--text-muted'),
    grid: token('--chart-grid'),
    rain: token('--chart-rain'),
    prob: token('--chart-prob'),
    level: token('--chart-level'),
    now: token('--chart-now'),
    stale: token('--stale-fill'),
    dangerFill: token('--danger-fill'),
    danger: token('--danger'),
    surface: token('--surface'),
  };
}

export const CHART_FONT = '12px "IBM Plex Sans Thai", system-ui, sans-serif';

/** uPlot time axis in Thai time whatever the device time zone is. */
export const bkkDate = (ts: number) => uPlot.tzDate(new Date(ts * 1000), 'Asia/Bangkok');

export interface PlotSpec {
  opts: Omit<uPlot.Options, 'width' | 'height'>;
  data: uPlot.AlignedData;
}

interface Props {
  /** Build the chart. Called again when the theme, language or `deps` change. */
  make: (colors: ChartColors) => PlotSpec;
  deps: unknown[];
  height: number;
  /** Text alternative for screen readers. */
  label: string;
}

/** Thin wrapper around uPlot: sizing, theme changes and cleanup. */
export function Plot({ make, deps, height, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick((n) => n + 1)), []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const spec = make(chartColors());
    const plot = new uPlot({ ...spec.opts, width: Math.max(240, el.clientWidth), height }, spec.data, el);
    const ro = new ResizeObserver(() => {
      const w = Math.max(240, el.clientWidth);
      if (w !== plot.width) plot.setSize({ width: w, height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, themeTick, height, getLang()]);

  return <div ref={host} class="plot" role="img" aria-label={label} style={{ minHeight: `${height}px` }} />;
}
