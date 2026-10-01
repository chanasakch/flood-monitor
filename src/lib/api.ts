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

export async function getLayer(type: LayerType): Promise<Layer> {
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
export const getHistory = (id: string) => cached<HistoryResponse>(`/api/history/${encodeURIComponent(id)}`, 5 * 60_000);

export function getForecast(lat: number, lng: number): Promise<ForecastResponse> {
  // Same rounding as the server so nearby points share a request.
  return cached<ForecastResponse>(`/api/forecast?lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}`, 5 * 60_000);
}
