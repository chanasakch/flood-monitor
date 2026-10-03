import { LAYER_SOURCE, LAYER_TYPES, RADAR_BOUNDS, SOURCE_IDS, SOURCES, THAILAND_BBOX } from '../shared/sources';
import type {
  HistoryPoint,
  HistoryResponse,
  LayerType,
  RadarResponse,
  SearchResponse,
  SourceId,
  SourcesResponse,
  SourceStatus,
} from '../shared/types';
import { refreshOnVisit } from './cron';
import { cacheGet, cachePut, getAllStatuses, getSnapshot, getStatus } from './db';
import { handleAdmin, lineWebhook } from './admin';
import { alertsStatus } from './alerts';
import type { Env } from './env';
import { getForecast } from './forecast';
import { fetchPhoton } from './fetchers/photon';
import { fetchRainGraph } from './fetchers/thaiwater-rain';
import { fetchWaterGraph } from './fetchers/thaiwater-water';
import { bkkDate, toBkkIso } from './lib/time';

const HISTORY_TTL_S = 30 * 60;

const BASE_HEADERS = { 'x-content-type-options': 'nosniff' };

function json(data: unknown, init: { status?: number; maxAge?: number } = {}): Response {
  return new Response(typeof data === 'string' ? data : JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      ...BASE_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': init.maxAge ? `public, max-age=${init.maxAge}` : 'no-store',
    },
  });
}

const error = (status: number, code: string) => json({ error: code }, { status });

function emptyStatus(source: SourceId): SourceStatus {
  return {
    source,
    last_attempt_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    consecutive_failures: 0,
    item_count: null,
    duration_ms: null,
  };
}

// ---------- /api/layers/:type ----------

async function layer(env: Env, ctx: ExecutionContext, type: LayerType): Promise<Response> {
  const source = LAYER_SOURCE[type];
  const [snap, status] = await Promise.all([getSnapshot(env.DB, type), getStatus(env.DB, source)]);
  // Thailand-only sources are refreshed here, in the background, when their data is due.
  // This response still carries the stored data; `refreshing` tells the page to ask again shortly.
  const refresh = await refreshOnVisit(env, type, snap?.fetched_at ?? null).catch(() => null);
  if (refresh) ctx.waitUntil(refresh);
  const head = JSON.stringify({ type, fetched_at: snap?.fetched_at ?? null, status: status ?? emptyStatus(source), refreshing: !!refresh });
  // The stored body is already `{"defaults":...,"items":[...]}`; splice it in without re-parsing megabytes of JSON.
  const body = snap ? `${head.slice(0, -1)},${snap.body.slice(1)}` : `${head.slice(0, -1)},"defaults":{},"items":[]}`;
  return json(body, { maxAge: refresh ? 0 : 60 });
}

async function radar(env: Env): Promise<Response> {
  const [snap, status] = await Promise.all([getSnapshot(env.DB, 'radar'), getStatus(env.DB, 'tmd-radar')]);
  let observedAt: string | null = null;
  if (snap) {
    try {
      observedAt = (JSON.parse(snap.body) as { observed_at?: string }).observed_at ?? null;
    } catch {
      observedAt = null;
    }
  }
  const res: RadarResponse = {
    observed_at: observedAt,
    fetched_at: snap?.fetched_at ?? null,
    // The time is part of the URL so each frame can be cached for a long time.
    image_url: observedAt ? `/api/radar/frame.png?t=${Date.parse(observedAt) / 1000}` : null,
    bounds: RADAR_BOUNDS,
    source: 'tmd-radar',
    source_url: SOURCES['tmd-radar'].url,
    status: status ?? emptyStatus('tmd-radar'),
  };
  return json(res, { maxAge: 60 });
}

async function radarFrame(env: Env): Promise<Response> {
  const row = await env.DB.prepare("SELECT body FROM blobs WHERE key = 'radar'").first<{ body: ArrayBuffer | number[] }>();
  if (!row) return error(404, 'no_radar_frame');
  const bytes = row.body instanceof ArrayBuffer ? row.body : new Uint8Array(row.body).buffer;
  return new Response(bytes, {
    headers: { ...BASE_HEADERS, 'content-type': 'image/png', 'cache-control': 'public, max-age=900' },
  });
}

// ---------- /api/forecast ----------

async function forecast(env: Env, url: URL): Promise<Response> {
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!url.searchParams.get('lat') || !url.searchParams.get('lng') || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return error(400, 'bad_coordinates');
  }
  const b = THAILAND_BBOX;
  if (lat < b.south || lat > b.north || lng < b.west || lng > b.east) return error(400, 'outside_thailand');
  const { body, fresh } = await getForecast(env, lat, lng);
  return json(body, { maxAge: fresh ? 300 : 0 });
}

// ---------- /api/history/:id ----------

const HISTORY_ID = /^(water|rain|road):(t?\d{1,12})$/;

async function history(env: Env, id: string): Promise<Response> {
  const m = HISTORY_ID.exec(id);
  if (!m) return error(400, 'bad_id');
  const kind = m[1] as 'water' | 'rain' | 'road';
  const now = Date.now();

  if (kind === 'road') {
    // Collected by our own cron (the BMA has no public history endpoint).
    const since = Math.floor(now / 1000) - 7 * 86400;
    const { results } = await env.DB.prepare('SELECT ts, value FROM history WHERE id = ? AND ts >= ? ORDER BY ts')
      .bind(id, since)
      .all<{ ts: number; value: number | null }>();
    const res: HistoryResponse = {
      id,
      unit: 'cm',
      source: 'bma-road',
      source_url: SOURCES['bma-road'].url,
      fetched_at: new Date(now).toISOString(),
      stale: false,
      points: results.map((r) => ({ time: toBkkIso(r.ts * 1000), value: r.value })),
    };
    return json(res, { maxAge: 300 });
  }

  const key = `hist:${id}`;
  const nowS = Math.floor(now / 1000);
  const cached = await cacheGet(env.DB, key);
  if (cached && cached.expires_at > nowS) return json(cached.body, { maxAge: 300 });

  const stationId = m[2];
  const source: SourceId = kind === 'water' ? 'thaiwater-water' : 'thaiwater-rain';
  const base = {
    id,
    unit: kind === 'water' ? 'm MSL' : 'mm',
    source,
    source_url: kind === 'water' ? `https://www.thaiwater.net/water/station/dataindex/tele_wl/${stationId}` : SOURCES[source].url,
  };
  try {
    let points: HistoryPoint[];
    let thresholds: HistoryResponse['thresholds'];
    if (kind === 'water') {
      const g = await fetchWaterGraph(stationId, bkkDate(now, -7), bkkDate(now));
      points = g.points;
      thresholds = g.thresholds;
    } else {
      points = await fetchRainGraph(stationId, bkkDate(now, -2), bkkDate(now));
    }
    const res: HistoryResponse = { ...base, fetched_at: new Date(now).toISOString(), stale: false, points, thresholds };
    const body = JSON.stringify(res);
    await cachePut(env.DB, key, res.fetched_at!, HISTORY_TTL_S, body);
    return json(body, { maxAge: 300 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[history ${id}] failed: ${message}`);
    if (cached) {
      // Last good answer, flagged so the chart is drawn grey.
      try {
        const old = JSON.parse(cached.body) as HistoryResponse;
        return json({ ...old, stale: true, error: message } satisfies HistoryResponse);
      } catch {
        /* fall through */
      }
    }
    const res: HistoryResponse = { ...base, fetched_at: null, stale: true, error: message, points: [] };
    return json(res);
  }
}

// ---------- /api/search ----------

const SEARCH_TTL_S = 7 * 86400;

/**
 * Place-name search for the search box, answered by Photon (OpenStreetMap data) and cached for a
 * week per query. The visitor's browser never talks to the search service itself.
 */
async function search(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (q.length < 2) return error(400, 'query_too_short');
  const key = `geo:${q.toLowerCase()}`;
  const nowS = Math.floor(Date.now() / 1000);
  const cached = await cacheGet(env.DB, key);
  if (cached && cached.expires_at > nowS) return json(cached.body, { maxAge: 3600 });
  try {
    const res: SearchResponse = { q, results: await fetchPhoton(q) };
    const body = JSON.stringify(res);
    await cachePut(env.DB, key, new Date().toISOString(), res.results.length ? SEARCH_TTL_S : 86400, body);
    return json(body, { maxAge: 3600 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[search] failed: ${message}`);
    if (cached) return json(cached.body);
    return json({ q, results: [], error: message } satisfies SearchResponse);
  }
}

// ---------- /api/sources ----------

async function sources(env: Env): Promise<Response> {
  const [statuses, log] = await Promise.all([
    getAllStatuses(env.DB),
    env.DB.prepare('SELECT source, at, ok, message FROM fetch_log ORDER BY id DESC LIMIT 40').all<{
      source: SourceId;
      at: string;
      ok: number;
      message: string | null;
    }>(),
  ]);
  const byId = new Map(statuses.map((s) => [s.source, s]));
  const res: SourcesResponse = {
    now: new Date().toISOString(),
    alerts: await alertsStatus(env).catch(() => undefined),
    sources: SOURCE_IDS.map((id) => byId.get(id) ?? emptyStatus(id)),
    recent_errors: log.results.map((r) => ({ source: r.source, at: r.at, ok: r.ok === 1, message: r.message })),
  };
  return json(res, { maxAge: 30 });
}

// ---------- router ----------

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  try {
    if (path === '/api/line/webhook' && request.method === 'POST') return await lineWebhook(request, env, ctx);
    if (path.startsWith('/api/admin/')) return await handleAdmin(request, env, path);
    if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'method_not_allowed');
    if (path === '/api/health') return json({ ok: true });
    if (path === '/api/sources') return await sources(env);
    if (path === '/api/forecast') return await forecast(env, url);
    if (path === '/api/search') return await search(env, url);
    if (path === '/api/radar/frame.png') return await radarFrame(env);
    if (path === '/api/layers/radar') return await radar(env);
    if (path.startsWith('/api/layers/')) {
      const type = path.slice('/api/layers/'.length) as LayerType;
      return LAYER_TYPES.includes(type) ? await layer(env, ctx, type) : error(404, 'unknown_layer');
    }
    if (path.startsWith('/api/history/')) return await history(env, decodeURIComponent(path.slice('/api/history/'.length)));
    return error(404, 'not_found');
  } catch (e) {
    console.error(`[api] ${path}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    return error(500, 'internal_error');
  }
}
