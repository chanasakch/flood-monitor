import { FUTURE_TOLERANCE_MINUTES } from './sources';
import type { Level } from './types';

// ---- Level rules. Every threshold here comes from the publishing agency, see SOURCES.md. ----

/** TMD 24 h rainfall classes: heavy > 35 mm, very heavy > 90 mm. */
export function rainLevel(rain24h: number | null): Level {
  if (rain24h == null || !Number.isFinite(rain24h) || rain24h < 0) return 'unknown';
  if (rain24h > 90) return 'danger';
  if (rain24h > 35) return 'watch';
  return 'normal';
}

/** 0 none, 1 light, 2 moderate, 3 heavy, 4 very heavy (TMD 24 h classes). */
export function rainClass(rain24h: number | null): 0 | 1 | 2 | 3 | 4 | null {
  if (rain24h == null || !Number.isFinite(rain24h) || rain24h < 0) return null;
  if (rain24h < 0.1) return 0;
  if (rain24h <= 10) return 1;
  if (rain24h <= 35) return 2;
  if (rain24h <= 90) return 3;
  return 4;
}

/** ThaiWater situation_level 1-5: 5 overflow, 4 high, 1-3 normal or low. */
export function waterLevel(situation: number | null | undefined): Level {
  if (situation == null) return 'unknown';
  if (situation >= 5) return 'danger';
  if (situation === 4) return 'watch';
  if (situation >= 1) return 'normal';
  return 'unknown';
}

/** BMA road sensors: <= 5 cm normal, > 5-10 cm slight flooding, > 10 cm flooding. */
export function roadLevel(cm: number | null | undefined): Level {
  if (cm == null || !Number.isFinite(cm) || cm < 0) return 'unknown';
  if (cm > 10) return 'danger';
  if (cm > 5) return 'watch';
  return 'normal';
}

/** Highway report: impassable is danger, a flood report that is still passable is watch. */
export function highwayLevel(passable: boolean | null | undefined): Level {
  if (passable == null) return 'unknown';
  return passable ? 'watch' : 'danger';
}

// ---- Freshness ----

export type Freshness = 'fresh' | 'stale' | 'future' | 'unknown';

/**
 * `stale`: older than the threshold. `future`: the source sent a time ahead of now, which cannot
 * be trusted. `unknown`: no time at all. Anything but `fresh` must be drawn grey.
 */
export function freshness(
  observedAt: string | null | undefined,
  staleMinutes: number | null,
  now: number = Date.now(),
): Freshness {
  if (staleMinutes == null) return 'fresh';
  if (!observedAt) return 'unknown';
  const t = Date.parse(observedAt);
  if (Number.isNaN(t)) return 'unknown';
  const ageMin = (now - t) / 60000;
  if (ageMin < -FUTURE_TOLERANCE_MINUTES) return 'future';
  if (ageMin > staleMinutes) return 'stale';
  return 'fresh';
}

/** The level to draw: grey (`unknown`) unless the reading is fresh. */
export function displayLevel(level: Level, fresh: Freshness): Level {
  return fresh === 'fresh' ? level : 'unknown';
}

const RANK: Record<Level, number> = { unknown: 0, normal: 1, watch: 2, danger: 3 };

export function worstLevel(levels: Level[]): Level {
  let worst: Level = 'unknown';
  for (const l of levels) if (RANK[l] > RANK[worst]) worst = l;
  return worst;
}
