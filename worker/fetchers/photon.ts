import type { SearchResult } from '../../shared/types';
import { assertFormat, fetchJson } from '../lib/http';
import { inThailandArea, num, text } from './util';

const URL_SEARCH = 'https://photon.komoot.io/api/';
/** Search only inside Thailand: west, south, east, north. */
const BBOX = '97.3,5.5,105.7,20.6';

/**
 * Normalise Photon (OpenStreetMap place search) results: named places inside Thailand with a
 * short description of where they are. Used only to move the map to a place the visitor typed;
 * it is never a source of flood data.
 */
export function parsePhoton(json: unknown): SearchResult[] {
  const features = (json as { features?: unknown })?.features;
  assertFormat(Array.isArray(features), 'photon features is not an array');
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const f of features as Record<string, any>[]) {
    const p = f?.properties ?? {};
    const lng = num(f?.geometry?.coordinates?.[0]);
    const lat = num(f?.geometry?.coordinates?.[1]);
    const name = text(p.name);
    if (!name || lat == null || lng == null || !inThailandArea(lat, lng)) continue;
    if (p.countrycode && p.countrycode !== 'TH') continue;
    const parts = [text(p.street), text(p.district), text(p.city) ?? text(p.county), text(p.state)].filter(
      (x, i, all): x is string => !!x && x !== name && all.indexOf(x) === i,
    );
    const key = `${name}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, detail: parts.join(' · '), lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, source: 'osm' });
  }
  return out;
}

export async function fetchPhoton(query: string): Promise<SearchResult[]> {
  const url = `${URL_SEARCH}?q=${encodeURIComponent(query)}&limit=8&bbox=${BBOX}`;
  return parsePhoton(await fetchJson(url, { timeoutMs: 9000 }));
}
