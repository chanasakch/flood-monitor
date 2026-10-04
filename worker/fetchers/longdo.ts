import type { SearchResult } from '../../shared/types';
import { assertFormat, fetchJson } from '../lib/http';
import { inThailandArea, num, text } from './util';

const URL_SEARCH = 'https://search.longdo.com/mapsearch/json/search';

/**
 * Normalise Longdo Map search results (Thai place database: hotels, condominiums, shops, sois...).
 * Used only to position the map on a place the visitor typed; never a source of flood data.
 */
export function parseLongdo(json: unknown): SearchResult[] {
  const data = (json as { data?: unknown })?.data;
  assertFormat(Array.isArray(data), 'longdo data is not an array');
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const row of data as Record<string, any>[]) {
    const lat = num(row?.lat);
    const lng = num(row?.lon);
    const name = text(row?.name);
    if (!name || lat == null || lng == null || !inThailandArea(lat, lng)) continue;
    const key = `${name}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, detail: text(row.address) ?? '', lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, source: 'longdo' });
  }
  return out;
}

export async function fetchLongdo(query: string, key: string, lang: 'th' | 'en', referer: string): Promise<SearchResult[]> {
  const url = `${URL_SEARCH}?keyword=${encodeURIComponent(query)}&limit=8&locale=${lang}&key=${encodeURIComponent(key)}`;
  // Longdo keys are tied to the site they were registered for; identify our site as the caller.
  return parseLongdo(await fetchJson(url, { timeoutMs: 9000, headers: { referer } }));
}
