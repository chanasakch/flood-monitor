import type {
  ForecastResponse,
  HistoryResponse,
  LayerResponse,
  LayerType,
  RadarResponse,
  Reading,
  SourcesResponse,
  SourceStatus,
} from '../../shared/types';

import { fetchDirectHistory, fetchDirectLayer, isDirectLayer } from './thaiwater';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

// ---- "showing saved data" flag, set when the service worker answers from its cache ----

let servedFromCache = false;
const cacheListeners = new Set<() => void>();
export const isServedFromCache = () => servedFromCache;
export function onServedFromCacheChange(fn: () => void): () => void {
  cacheListeners.add(fn);
  return () => cacheListeners.delete(fn);
}
function setServedFromCache(v: boolean): void {
  if (v === servedFromCache) return;
  servedFromCache = v;
  cacheListeners.forEach((fn) => fn());
}

// ---- small in-memory cache so pages share one request per resource ----

const mem = new Map<string, { at: number; promise: Promise<unknown> }>();

async function request<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new ApiError('network', 0);
  }
  setServedFromCache(res.headers.get('x-fm-cache') === '1');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('bad_response', res.status);
  }
  if (!res.ok) throw new ApiError((body as { error?: string })?.error ?? 'http_error', res.status);
  return body as T;
}

function cached<T>(url: string, ttlMs: number): Promise<T> {
  const hit = mem.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise as Promise<T>;
  const promise = request<T>(url);
  mem.set(url, { at: Date.now(), promise });
  promise.catch(() => {
    if (mem.get(url)?.promise === promise) mem.delete(url);
  });
  return promise;
}

export function clearApiCache(): void {
  mem.clear();
}

export interface Layer {
  type: LayerType;
  fetched_at: string | null;
  status: SourceStatus | null;
  items: Reading[];
}

/** Restore the full common schema from the packed transfer format. */
function unpack(res: LayerResponse): Layer {
  const d = res.defaults ?? {};
  const items = res.items.map((item) => ({ name_en: null, ...d, ...item }) as Reading);
  return { type: res.type, fetched_at: res.fetched_at, status: res.status, items };
}

const unpacked = new WeakMap<object, Layer>();

const refreshListeners = new Set<() => void>();
/** Fires a few seconds after the server started refreshing a layer, when newer data should be ready. */
export function onLayerRefreshed(fn: () => void): () => void {
  refreshListeners.add(fn);
  return () => refreshListeners.delete(fn);
}
const pendingRefresh = new Set<string>();

/** Rain and water level come straight from ThaiWater in the browser (see thaiwater.ts); 10 min in memory. */
function getDirectLayer(type: 'rain' | 'water'): Promise<Layer> {
  const key = `direct:${type}`;
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.promise as Promise<Layer>;
  const promise = fetchDirectLayer(type).then((r) => {
    if (r.fromCache) setServedFromCache(true);
    // A failed attempt is not kept, so the next page view tries again.
    if (!r.fetched_at && mem.get(key)?.promise === promise) mem.delete(key);
    return { type, fetched_at: r.fetched_at, status: r.status, items: r.items } satisfies Layer;
  });
  mem.set(key, { at: Date.now(), promise });
  return promise;
}

export async function getLayer(type: LayerType): Promise<Layer> {
  if (isDirectLayer(type)) return getDirectLayer(type);
  const url = `/api/layers/${type}`;
  const res = await cached<LayerResponse>(url, 60_000);
  if (res.refreshing && !pendingRefresh.has(url)) {
    pendingRefresh.add(url);
    setTimeout(() => {
      pendingRefresh.delete(url);
      mem.delete(url);
      refreshListeners.forEach((fn) => fn());
    }, 9000);
  }
  let layer = unpacked.get(res);
  if (!layer) {
    layer = unpack(res);
    unpacked.set(res, layer);
  }
  return layer;
}

export const getRadar = () => cached<RadarResponse>('/api/layers/radar', 60_000);
export const getSources = () => cached<SourcesResponse>('/api/sources', 20_000);
export function getHistory(id: string): Promise<HistoryResponse> {
  if (id.startsWith('road:')) return cached<HistoryResponse>(`/api/history/${encodeURIComponent(id)}`, 5 * 60_000);
  // Water level and rain history: straight from ThaiWater, like the layers.
  const key = `direct:${id}`;
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.promise as Promise<HistoryResponse>;
  const promise = fetchDirectHistory(id);
  mem.set(key, { at: Date.now(), promise });
  return promise;
}

export function getForecast(lat: number, lng: number): Promise<ForecastResponse> {
  // Same rounding as the server so nearby points share a request.
  return cached<ForecastResponse>(`/api/forecast?lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}`, 5 * 60_000);
}
