import type { ForecastResponse } from '../../shared/types';
import { formatNumber, formatTime } from './format';
import { t } from './i18n';
import { forecastFresh } from './status';

export interface HourPoint {
  /** Start of the hour, ms since epoch. */
  ms: number;
  mm: number | null;
  prob: number | null;
}

export interface ForecastView {
  hours: HourPoint[];
  /** Which source the mm values come from. Null when neither source is usable. */
  mmSource: 'tmd-nwp' | 'open-meteo' | null;
  /** Probability only ever comes from Open-Meteo. */
  hasProb: boolean;
  /** Fetch time of the mm source, for "updated x ago". */
  fetchedAt: string | null;
  /** True when a source answered but is older than the forecast threshold: drawn grey. */
  stale: boolean;
  /** TMD was expected but failed, so Open-Meteo is standing in. */
  usingFallback: boolean;
}

/**
 * Merge both sources into one hourly series starting at the current hour.
 * mm comes from TMD when it is usable, otherwise from Open-Meteo; probability from Open-Meteo.
 * Hours a source does not cover stay null. Nothing is interpolated.
 */
export function buildForecast(res: ForecastResponse, now: number, hoursAhead: number): ForecastView {
  const tmdFresh = forecastFresh(res.tmd, now);
  const omFresh = forecastFresh(res.openmeteo, now);
  const mmPart = tmdFresh ? res.tmd : omFresh ? res.openmeteo : res.tmd.ok ? res.tmd : res.openmeteo.ok ? res.openmeteo : null;
  const stale = !!mmPart && !tmdFresh && !omFresh;
  const probPart = res.openmeteo.ok && (omFresh || stale) ? res.openmeteo : null;

  const start = Math.floor(now / 3600000) * 3600000;
  const mmBy = new Map<number, number | null>();
  const probBy = new Map<number, number | null>();
  for (const h of mmPart?.hours ?? []) mmBy.set(Date.parse(h.time), h.mm);
  for (const h of probPart?.hours ?? []) probBy.set(Date.parse(h.time), h.prob ?? null);

  const hours: HourPoint[] = [];
  for (let i = 0; i < hoursAhead; i++) {
    const ms = start + i * 3600000;
    hours.push({ ms, mm: mmBy.get(ms) ?? null, prob: probBy.get(ms) ?? null });
  }
  return {
    hours,
    mmSource: mmPart ? mmPart.source as 'tmd-nwp' | 'open-meteo' : null,
    hasProb: hours.some((h) => h.prob != null),
    fetchedAt: mmPart?.fetched_at ?? null,
    stale,
    usingFallback: !!mmPart && mmPart.source === 'open-meteo',
  };
}

const HIGH = 60;
const MODERATE = 30;

/**
 * One plain sentence about the next 12 hours, built only from the forecast values.
 * It describes probability and never promises a time when rain stops.
 */
export function summarize(view: ForecastView): string | null {
  if (view.stale || !view.mmSource) return null;
  const h = view.hours.slice(0, 12);
  const parts: string[] = [];

  if (view.hasProb) {
    const high = h.map((x) => x.prob != null && x.prob >= HIGH);
    const firstHigh = high.indexOf(true);
    if (high.every(Boolean)) parts.push(t('forecast.sumHighAll'));
    else if (high[0]) {
      const end = high.indexOf(false);
      parts.push(t('forecast.sumHighUntil', { time: formatTime(h[end].ms) }));
    } else if (firstHigh > 0) parts.push(t('forecast.sumHighFrom', { time: formatTime(h[firstHigh].ms) }));
    else if (h.some((x) => x.prob != null && x.prob >= MODERATE)) parts.push(t('forecast.sumModerate'));
    else parts.push(t('forecast.sumLow'));
  }

  let peak: HourPoint | null = null;
  for (const x of h) if (x.mm != null && x.mm >= 1 && (!peak || x.mm > peak.mm!)) peak = x;
  if (peak) parts.push(t('forecast.sumPeak', { time: formatTime(peak.ms), mm: formatNumber(peak.mm, 1) }));

  return parts.length ? parts.join(' · ') : null;
}
