import { SOURCES } from '../shared/sources';
import type { ForecastPart, ForecastResponse } from '../shared/types';
import { cacheGet, cachePut, recordFailure, recordSuccess } from './db';
import type { Env } from './env';
import { fetchOpenMeteo } from './fetchers/open-meteo';
import { fetchTmdHourly } from './fetchers/tmd-nwp';

const FORECAST_TTL_S = 30 * 60;
const RETRY_AFTER_FAILURE_S = 3 * 60;

async function fetchPart(
  env: Env,
  source: 'tmd-nwp' | 'open-meteo',
  job: () => Promise<ForecastPart['hours']>,
): Promise<ForecastPart> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  const base = { source, source_url: SOURCES[source].url };
  try {
    const hours = await job();
    await recordSuccess(env.DB, source, at, hours.length, Date.now() - started);
    return { ...base, ok: true, fetched_at: at, hours };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[${source}] forecast failed: ${message}`);
    await recordFailure(env.DB, source, at, message, Date.now() - started).catch(() => {});
    return { ...base, ok: false, fetched_at: null, error: message, hours: [] };
  }
}

/**
 * Hourly forecast for a point: TMD for mm/h when available, Open-Meteo for probability and as
 * fallback. Cached 30 minutes per ~1 km grid cell, shared by the API and the alert job.
 * `fresh` is false when a part failed and an older answer stands in for it.
 */
export async function getForecast(env: Env, lat: number, lng: number): Promise<{ res: ForecastResponse; body: string; fresh: boolean }> {
  const rLat = Math.round(lat * 100) / 100;
  const rLng = Math.round(lng * 100) / 100;
  const key = `fc:${rLat.toFixed(2)},${rLng.toFixed(2)}`;
  const nowS = Math.floor(Date.now() / 1000);

  const cached = await cacheGet(env.DB, key);
  let previous: ForecastResponse | null = null;
  if (cached) {
    try {
      previous = JSON.parse(cached.body) as ForecastResponse;
    } catch {
      previous = null;
    }
  }
  if (cached && previous && cached.expires_at > nowS) return { res: previous, body: cached.body, fresh: true };

  const token = env.TMD_API_TOKEN?.trim();
  const [tmdNew, omNew] = await Promise.all([
    token
      ? fetchPart(env, 'tmd-nwp', () => fetchTmdHourly(rLat, rLng, token))
      : Promise.resolve<ForecastPart>({
          ok: false,
          source: 'tmd-nwp',
          source_url: SOURCES['tmd-nwp'].url,
          fetched_at: null,
          error: 'TMD_API_TOKEN is not configured',
          hours: [],
        }),
    fetchPart(env, 'open-meteo', () => fetchOpenMeteo(rLat, rLng)),
  ]);

  // A failed part falls back to its last good answer. It keeps its old `fetched_at`,
  // so the UI greys it out once it is older than the forecast threshold. Values are never invented.
  const keep = (fresh: ForecastPart, old: ForecastPart | undefined): ForecastPart =>
    !fresh.ok && old?.ok ? { ...old, error: fresh.error } : fresh;
  const tmd = keep(tmdNew, previous?.tmd);
  const openmeteo = keep(omNew, previous?.openmeteo);

  const res: ForecastResponse = {
    lat: rLat,
    lng: rLng,
    primary: tmd.ok ? 'tmd-nwp' : openmeteo.ok ? 'open-meteo' : null,
    tmd,
    openmeteo,
  };
  const body = JSON.stringify(res);
  const allFresh = (tmdNew.ok || !token) && omNew.ok;
  if (tmd.ok || openmeteo.ok) {
    await cachePut(env.DB, key, new Date().toISOString(), allFresh ? FORECAST_TTL_S : RETRY_AFTER_FAILURE_S, body);
  }
  return { res, body, fresh: allFresh };
}
