import { useState } from 'preact/hooks';
import uPlot from 'uplot';
import type { HistoryPoint } from '../../../shared/types';
import { formatDate, formatDateTime, formatHour, formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { bkkDate, CHART_FONT, Plot, type ChartColors, type PlotSpec } from './Plot';

interface Props {
  points: HistoryPoint[];
  kind: 'line' | 'bars';
  unit: string;
  label: string;
  /** Drawn grey when the data is not current. */
  stale?: boolean;
  /** Alert threshold: the area above it is shaded as a band (water level only). */
  band?: { value: number; label: string } | null;
  digits?: number;
}

/** Time series chart: a line (water level) or hourly bars (rain). Missing hours stay as gaps. */
export default function SeriesChart({ points, kind, unit, label, stale = false, band = null, digits = 2 }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const make = (c: ChartColors): PlotSpec => {
    const color = stale ? c.stale : kind === 'bars' ? c.rain : c.level;
    const xs = points.map((p) => Date.parse(p.time) / 1000);
    const spanDays = xs.length > 1 ? (xs[xs.length - 1] - xs[0]) / 86400 : 0;
    return {
      data: [xs, points.map((p) => p.value)],
      opts: {
        tzDate: bkkDate,
        legend: { show: false },
        padding: [14, 10, 0, 0],
        cursor: { drag: { x: false, y: false }, points: { show: kind === 'line', size: 8 }, y: false },
        scales: {
          x: { time: true },
          y: {
            range: (_u, min, max) => {
              if (kind === 'bars') return [0, Math.max(5, (max || 0) * 1.2)];
              let lo = min ?? 0;
              let hi = max ?? 1;
              // Keep the threshold in view so the distance to it can be read.
              if (band) {
                lo = Math.min(lo, band.value);
                hi = Math.max(hi, band.value);
              }
              const pad = Math.max((hi - lo) * 0.12, 0.1);
              return [lo - pad, hi + pad];
            },
          },
        },
        axes: [
          {
            stroke: c.muted,
            font: CHART_FONT,
            grid: { stroke: c.grid, width: 1 },
            ticks: { stroke: c.grid, width: 1 },
            space: 60,
            size: 46,
            values: (_u, splits) =>
              splits.map((s) => {
                const ms = s * 1000;
                const hhmm = formatHour(ms);
                const day = formatDate(ms).replace(/\s?\d{4}$/, '');
                if (spanDays > 3) return day;
                return hhmm.startsWith('00') || hhmm.startsWith('24') ? `${hhmm}\n${day}` : hhmm;
              }),
          },
          {
            stroke: c.muted,
            font: CHART_FONT,
            grid: { stroke: c.grid, width: 1 },
            ticks: { show: false },
            size: 52,
            values: (_u, splits) => splits.map((v) => formatNumber(v, kind === 'bars' ? 1 : digits)),
          },
        ],
        series: [
          {},
          kind === 'bars'
            ? { stroke: color, fill: color, paths: uPlot.paths.bars!({ size: [0.7, 28] }), points: { show: false } }
            : { stroke: color, width: 2.5, points: { show: false }, spanGaps: false },
        ],
        hooks: {
          setCursor: [(u) => setHover(u.cursor.idx ?? null)],
          drawClear: [
            (u) => {
              if (!band) return;
              const { top, left, width, height } = u.bbox;
              const y = Math.round(u.valToPos(band.value, 'y', true));
              if (y < top || y > top + height) return;
              const ctx = u.ctx;
              const dpr = devicePixelRatio || 1;
              ctx.save();
              ctx.globalAlpha = 0.16;
              ctx.fillStyle = c.dangerFill;
              ctx.fillRect(left, top, width, y - top);
              ctx.globalAlpha = 1;
              ctx.strokeStyle = c.dangerFill;
              ctx.lineWidth = 1.5 * dpr;
              ctx.setLineDash([6 * dpr, 4 * dpr]);
              ctx.beginPath();
              ctx.moveTo(left, y);
              ctx.lineTo(left + width, y);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = c.danger;
              ctx.font = `600 ${12 * dpr}px "IBM Plex Sans Thai", system-ui, sans-serif`;
              ctx.textAlign = 'right';
              ctx.textBaseline = y - top > 18 * dpr ? 'bottom' : 'top';
              ctx.fillText(`${band.label} ${formatNumber(band.value, digits)}`, left + width - 6 * dpr, y + (y - top > 18 * dpr ? -3 : 3) * dpr);
              ctx.restore();
            },
          ],
        },
      },
    };
  };

  const p = hover != null ? points[hover] : null;
  return (
    <div>
      <Plot make={make} deps={[points, kind, stale, band?.value]} height={220} label={label} />
      <p class="plot-readout num">
        {p ? (
          <>
            <strong>{formatDateTime(p.time)}</strong> · {p.value == null ? t('common.noData') : `${formatNumber(p.value, digits)} ${unit}`}
          </>
        ) : (
          <span class="muted">&nbsp;</span>
        )}
      </p>
    </div>
  );
}
