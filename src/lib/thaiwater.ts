// ThaiWater is fetched by the visitor's browser, not by our Worker.
//
// Why: api-v3.thaiwater.net answers every request from a Cloudflare Worker with 429 (see
// SOURCES.md, "Reachability from the Worker"), while a normal Thai connection gets 200 and the API
// allows cross-origin requests. The responses go through exactly the same parsers the Worker
// would use (tested against fixtures), and the service worker keeps a copy for 10 minutes so
// reloading the page does not download them again.

import type { HistoryResponse, LayerType, Reading, SourceId, SourceStatus } from '../../shared/types';
import { SOURCES } from '../../shared/sources';
import { parseRain, parseRainGraph } from '../../worker/fetchers/thaiwater-rain';
import { parseWater, parseWaterGraph } from '../../worker/fetchers/thaiwater-water';

const BASE = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/';
const STATUS_KEY = 'fm.directStatus';

export type DirectLayer = 'rain' | 'water';
export const DIRECT_SOURCE: Record<DirectLayer, SourceId> = { rain: 'thaiwater-rain', water: 'thaiwater-water' };
export const isDirectLayer = (type: LayerType): type is DirectLayer => type === 'rain' || type === 'water';
export const isDirectSource = (id: SourceId): boolean => id === 'thaiwater-rain' || id === 'thaiwater-water';

// ---- fetch status, kept in this browser so the status page can show it ----

type StatusMap = Partial<Record<SourceId, SourceStatus>>;

function readStatuses(): StatusMap {
  try {
    return JSON.parse(localStorage.getItem(STATUS_KEY) ?? '{}') as StatusMap;
  } catch {
    return {};
  }
}

export function directStatus(source: SourceId): SourceStatus {
  return (
    readStatuses()[source] ?? {
      source,
      last_attempt_at: null,
      last_success_at: null,
      last_error_at: null,
      last_error: null,
      consecutive_failures: 0,
      item_count: null,
      duration_ms: null,
    }
  );
}

function record(source: SourceId, at: string, ms: number, result: { items: number } | { error: string }): SourceStatus {
  const prev = directStatus(source);
  const next: SourceStatus =
    'items' in result
      ? { ...prev, last_attempt_at: at, last_success_at: at, consecutive_failures: 0, item_count: result.items, duration_ms: ms }
      : { ...prev, last_attempt_at: at, last_error_at: at, last_error: result.error, consecutive_failures: prev.consecutive_failures + 1, duration_ms: ms };
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify({ ...readStatuses(), [source]: next }));
  } catch {
    /* storage unavailable: status is simply not remembered */
  }
  return next;
}

// ---- requests ----

interface Fetched {
  json: unknown;
  /** When the data left ThaiWater: now, or earlier if the service worker served its saved copy. */
  fetchedAt: string;
  fromCache: boolean;
}

async function get(path: string): Promise<Fetched> {
  // A plain GET with no custom headers, so the browser sends no CORS preflight.
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const stored = res.headers.get('x-fm-stored');
  return { json: await res.json(), fetchedAt: stored ?? new Date().toISOString(), fromCache: res.headers.get('x-fm-cache') === '1' };
}

export interface DirectResult {
  items: Reading[];
  fetched_at: string | null;
  status: SourceStatus;
  fromCache: boolean;
}

/** Latest readings for the rain or water level layer. Never throws: a failure comes back as an empty layer with a failing status. */
export async function fetchDirectLayer(type: DirectLayer): Promise<DirectResult> {
  const source = DIRECT_SOURCE[type];
  const started = Date.now();
  const at = new Date(started).toISOString();
  try {
    const got = await get(type === 'rain' ? 'rain_24h' : 'waterlevel_load');
    const items = type === 'rain' ? parseRain(got.json) : parseWater(got.json);
    const status = got.fromCache ? directStatus(source) : record(source, at, Date.now() - started, { items: items.length });
    return { items, fetched_at: got.fetchedAt, status, fromCache: got.fromCache };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { items: [], fetched_at: null, status: record(source, at, Date.now() - started, { error }), fromCache: false };
  }
}

const bkkDate = (ms: number) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);

/** Station history: 7 days of water level, about 2 days of hourly rain. */
export async function fetchDirectHistory(id: string): Promise<HistoryResponse> {
  const [kind, stationId] = id.split(':') as ['water' | 'rain', string];
  const now = Date.now();
  const source = DIRECT_SOURCE[kind];
  const base = {
    id,
    unit: kind === 'water' ? 'm MSL' : 'mm',
    source,
    source_url: kind === 'water' ? `https://www.thaiwater.net/water/station/dataindex/tele_wl/${stationId}` : SOURCES[source].url,
  };
  try {
    if (!/^\d{1,12}$/.test(stationId)) throw new Error('bad station id');
    if (kind === 'water') {
      const got = await get(`waterlevel_graph?station_type=tele_waterlevel&station_id=${stationId}&start_date=${bkkDate(now - 7 * 86400000)}&end_date=${bkkDate(now)}`);
      const g = parseWaterGraph(got.json);
      return { ...base, fetched_at: got.fetchedAt, stale: got.fromCache, points: g.points, thresholds: g.thresholds };
    }
    const got = await get(`rain_24h_graph?station_id=${stationId}&start_date=${bkkDate(now - 2 * 86400000)}&end_date=${bkkDate(now)}`);
    return { ...base, fetched_at: got.fetchedAt, stale: got.fromCache, points: parseRainGraph(got.json) };
  } catch (e) {
    return { ...base, fetched_at: null, stale: true, error: e instanceof Error ? e.message : String(e), points: [] };
  }
}
