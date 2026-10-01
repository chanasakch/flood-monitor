import type { ForecastView } from '../lib/forecast';
import { formatHour, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';

const W = 264;
const H = 78;
const TOP = 6;
const BASE = 58;

/**
 * Small 12-hour chart for place cards: bars for mm per hour, a line for chance of rain.
 * Plain SVG, coloured from the theme tokens. Grey when the forecast is not current.
 */
export function MiniForecast({ view }: { view: ForecastView }) {
  const hours = view.hours.slice(0, 12);
  const maxMm = Math.max(5, ...hours.map((h) => h.mm ?? 0));
  const step = W / hours.length;
  const barW = step * 0.62;
  const y = (mm: number) => BASE - (mm / maxMm) * (BASE - TOP);
  const yProb = (p: number) => BASE - (p / 100) * (BASE - TOP);

  const peak = hours.reduce<(typeof hours)[number] | null>((best, h) => (h.mm != null && (!best || h.mm > (best.mm ?? 0)) ? h : best), null);
  const maxProb = hours.reduce((m, h) => (h.prob != null && h.prob > m ? h.prob : m), -1);
  const label =
    `${t('forecast.next12')}. ` +
    (peak && peak.mm != null ? `${t('forecast.bars')}: ${formatNumber(peak.mm)} (${formatHour(peak.ms)}). ` : '') +
    (maxProb >= 0 ? `${t('forecast.line')}: ${formatNumber(maxProb, 0)}.` : '');

  const probPoints = hours
    .map((h, i) => (h.prob == null ? null : `${(i * step + step / 2).toFixed(1)},${yProb(h.prob).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');

  return (
    <svg class={`mini-forecast${view.stale ? ' is-stale' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <line x1="0" x2={W} y1={BASE} y2={BASE} class="mf-axis" />
      {hours.map((h, i) =>
        h.mm == null ? null : (
          <rect
            key={h.ms}
            class="mf-bar"
            x={(i * step + (step - barW) / 2).toFixed(1)}
            y={Math.min(y(h.mm), BASE - (h.mm > 0 ? 2 : 0)).toFixed(1)}
            width={barW.toFixed(1)}
            height={Math.max(BASE - y(h.mm), h.mm > 0 ? 2 : 0).toFixed(1)}
            rx="2"
          />
        ),
      )}
      {probPoints && <polyline class="mf-prob" points={probPoints} />}
      {hours.map((h, i) =>
        i % 3 === 0 ? (
          <text key={h.ms} class="mf-tick" x={(i * step + step / 2).toFixed(1)} y={H - 4} text-anchor="middle">
            {i === 0 ? t('forecast.now') : formatHour(h.ms)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
