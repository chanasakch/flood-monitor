import { useState } from 'preact/hooks';
import uPlot from 'uplot';
import type { ForecastView } from '../../lib/forecast';
import { formatDate, formatHour, formatNumber, formatTime } from '../../lib/format';
import { t } from '../../lib/i18n';
import { bkkDate, CHART_FONT, Plot, type ChartColors, type PlotSpec } from './Plot';

interface Props {
  view: ForecastView;
  now: number;
}

/** Hourly forecast: bars for mm per hour (left axis), line for chance of rain (right axis), "now" marker. */
export default function ForecastChart({ view, now }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const hours = view.hours;

  const make = (c: ChartColors): PlotSpec => {
    const barColor = view.stale ? c.stale : c.rain;
    const lineColor = view.stale ? c.stale : c.prob;
    const xs = hours.map((h) => h.ms / 1000);
    return {
      data: [xs, hours.map((h) => h.mm), hours.map((h) => h.prob)],
      opts: {
        tzDate: bkkDate,
        legend: { show: false },
        padding: [16, 4, 0, 0],
        cursor: { drag: { x: false, y: false }, points: { show: false }, y: false },
        scales: {
          x: { time: true },
          mm: { range: (_u, _min, max) => [0, Math.max(5, (max || 0) * 1.2)] },
          prob: { range: [0, 100] },
        },
        axes: [
          {
            stroke: c.muted,
            font: CHART_FONT,
            grid: { stroke: c.grid, width: 1 },
            ticks: { stroke: c.grid, width: 1 },
            space: 54,
            size: 46,
            // Hour labels; at midnight the date goes on a second line.
            values: (_u, splits) =>
              splits.map((s) => {
                const ms = s * 1000;
                const hhmm = formatHour(ms);
                return hhmm.startsWith('00') || hhmm.startsWith('24') ? `${hhmm}\n${formatDate(ms).replace(/\s?\d{4}$/, '')}` : hhmm;
              }),
          },
          {
            scale: 'mm',
            stroke: barColor,
            font: CHART_FONT,
            grid: { stroke: c.grid, width: 1 },
            ticks: { show: false },
            size: 38,
            values: (_u, splits) => splits.map((v) => formatNumber(v, 1)),
          },
          {
            scale: 'prob',
            side: 1,
            stroke: lineColor,
            font: CHART_FONT,
            grid: { show: false },
            ticks: { show: false },
            size: 42,
            splits: () => [0, 25, 50, 75, 100],
            values: (_u, splits) => splits.map((v) => `${v}%`),
            show: view.hasProb,
          },
        ],
        series: [
          {},
          { scale: 'mm', stroke: barColor, fill: barColor, paths: uPlot.paths.bars!({ size: [0.62, 40] }), points: { show: false } },
          { scale: 'prob', stroke: lineColor, width: 2.5, points: { show: false }, spanGaps: false, show: view.hasProb },
        ],
        hooks: {
          setCursor: [(u) => setHover(u.cursor.idx ?? null)],
          draw: [
            (u) => {
              // "Now" marker.
              const x = u.valToPos(now / 1000, 'x', true);
              const { top, height, left, width } = u.bbox;
              if (x < left || x > left + width) return;
              const ctx = u.ctx;
              const dpr = devicePixelRatio || 1;
              ctx.save();
              ctx.strokeStyle = c.now;
              ctx.lineWidth = 1.5 * dpr;
              ctx.setLineDash([4 * dpr, 4 * dpr]);
              ctx.beginPath();
              ctx.moveTo(x, top);
              ctx.lineTo(x, top + height);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = c.now;
              ctx.font = `600 ${12 * dpr}px "IBM Plex Sans Thai", system-ui, sans-serif`;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'bottom';
              ctx.fillText(t('forecast.now'), x + 4 * dpr, top - 2 * dpr);
              ctx.restore();
            },
          ],
        },
      },
    };
  };

  const h = hover != null ? hours[hover] : null;
  return (
    <div>
      <Plot make={make} deps={[view, Math.floor(now / 300000)]} height={236} label={t('forecast.title')} />
      <p class="plot-readout num" aria-live="off">
        {h ? (
          <>
            <strong>{formatTime(h.ms)}</strong> · {h.mm == null ? t('common.noData') : `${formatNumber(h.mm, 1)} ${t('unit.mmh')}`}
            {view.hasProb && <> · {h.prob == null ? '–' : `${formatNumber(h.prob, 0)}%`}</>}
          </>
        ) : (
          <span class="muted">&nbsp;</span>
        )}
      </p>
    </div>
  );
}
