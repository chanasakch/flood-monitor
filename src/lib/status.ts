import { displayLevel, freshness, rainClass, worstLevel, type Freshness } from '../../shared/levels';
import { SOURCES, STALE_MINUTES } from '../../shared/sources';
import type { ForecastPart, Level, Reading } from '../../shared/types';
import { t } from './i18n';

export interface Shown {
  /** Level to draw. `unknown` (grey) whenever the reading is not fresh or has no value. */
  level: Level;
  fresh: Freshness;
  /** Text paired with the colour. */
  label: string;
}

/** Decide how a reading is drawn right now. Stale data never keeps its last colour. */
export function shown(r: Reading, now: number): Shown {
  const fresh = freshness(r.observed_at, SOURCES[r.source].stale_minutes, now);
  const level = displayLevel(r.level, fresh);
  return { level, fresh, label: labelFor(r, level, fresh) };
}

function labelFor(r: Reading, level: Level, fresh: Freshness): string {
  if (fresh !== 'fresh') return t('common.notCurrent');
  if (level === 'unknown') return r.type === 'road' ? t('road.offline') : t('common.noData');
  switch (r.type) {
    case 'rain': {
      const c = rainClass(r.value);
      return c == null ? t('common.noData') : t(`rain.class${c}`);
    }
    case 'water': {
      const s = r.extra?.situation;
      return typeof s === 'number' && s >= 1 && s <= 5 ? t(`water.s${s}`) : t(`level.${level}`);
    }
    case 'road':
      return t(`road.${level}`);
    case 'highway':
      return r.extra?.passable === false ? t('highway.impassable') : t('highway.passable');
    default:
      return t(`level.${level}`);
  }
}

/** Worst level among readings that are fresh. `unknown` when none of them is. */
export function overallLevel(readings: Reading[], now: number): Level {
  return worstLevel(readings.map((r) => shown(r, now).level));
}

/** A forecast part is usable only when it loaded and is younger than the forecast threshold. */
export function forecastFresh(part: ForecastPart | undefined, now: number): boolean {
  return !!part?.ok && freshness(part.fetched_at, STALE_MINUTES.forecast, now) === 'fresh';
}

export function typeName(type: Reading['type']): string {
  return t(`${type}.title`);
}
