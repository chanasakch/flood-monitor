import type { SearchResponse, SearchResult } from '../../shared/types';
import { extractUrl, parsePasted, shortLinkIn, type PastedPlace } from '../../shared/geolink';
import { LONGDO_SEARCH_URL, parseLongdo } from '../../worker/fetchers/longdo';
import { getLang } from './i18n';

// ---- Built-in list of provinces, districts and subdistricts (public/gazetteer.json) ----

export interface Gazetteer {
  p: [th: string, en: string][];
  a: [th: string, en: string, province: number][];
  t: [th: string, district: number, lat: number, lng: number][];
}

interface Entry {
  level: 0 | 1 | 2; // province, district, subdistrict
  /** Own name, lower case, Thai and English. */
  own: string[];
  /** Own and parent names joined, for matching every word the visitor typed. */
  hay: string;
  lat: number;
  lng: number;
  th: { name: string; detail: string };
  en: { name: string; detail: string };
}

let entries: Promise<Entry[]> | null = null;

const BKK = 'กรุงเทพมหานคร';

export function buildGazetteer(g: Gazetteer): Entry[] {
  const out: Entry[] = [];
  // Districts and provinces have no point of their own: use the centre of their subdistricts.
  const sumA = g.a.map(() => [0, 0, 0]);
  const sumP = g.p.map(() => [0, 0, 0]);
  for (const [, a, lat, lng] of g.t) {
    const p = g.a[a][2];
    sumA[a][0] += lat;
    sumA[a][1] += lng;
    sumA[a][2]++;
    sumP[p][0] += lat;
    sumP[p][1] += lng;
    sumP[p][2]++;
  }
  g.p.forEach(([th, en], i) => {
    const bkk = th === BKK;
    out.push({
      level: 0,
      own: [th, en.toLowerCase()],
      hay: `${th} ${en}`.toLowerCase(),
      lat: sumP[i][0] / sumP[i][2],
      lng: sumP[i][1] / sumP[i][2],
      th: { name: bkk ? th : `จ.${th}`, detail: '' },
      en: { name: en || th, detail: bkk ? '' : 'Province' },
    });
  });
  g.a.forEach(([th, en, p], i) => {
    const [pth, pen] = g.p[p];
    const bkk = pth === BKK;
    out.push({
      level: 1,
      own: [th, en.toLowerCase()],
      hay: `${th} ${en} ${pth} ${pen}`.toLowerCase(),
      lat: sumA[i][0] / sumA[i][2],
      lng: sumA[i][1] / sumA[i][2],
      th: { name: `${bkk ? 'เขต' : 'อ.'}${th}`, detail: bkk ? pth : `จ.${pth}` },
      en: { name: `${en || th}${bkk ? ' District' : ''}`, detail: pen || pth },
    });
  });
  for (const [th, a, lat, lng] of g.t) {
    const [ath, aen, p] = g.a[a];
    const [pth, pen] = g.p[p];
    const bkk = pth === BKK;
    out.push({
      level: 2,
      own: [th],
      hay: `${th} ${ath} ${aen} ${pth} ${pen}`.toLowerCase(),
      lat,
      lng,
      th: { name: `${bkk ? 'แขวง' : 'ต.'}${th}`, detail: bkk ? `เขต${ath} ${pth}` : `อ.${ath} จ.${pth}` },
      en: { name: th, detail: `${aen || ath}, ${pen || pth}` },
    });
  }
  return out;
}

/** Load the list on first use (about 110 KB compressed, cached by the service worker). */
export function loadGazetteer(): Promise<Entry[]> {
  if (!entries) {
    entries = fetch('/gazetteer.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Gazetteer>;
      })
      .then(buildGazetteer)
      .catch((e) => {
        entries = null;
        throw e;
      });
  }
  return entries;
}

const PREFIX = /^(ตำบล|แขวง|อำเภอ|เขต|จังหวัด|ต\.|อ\.|จ\.)\s*/;

/** Words the visitor typed, without administrative prefixes such as "ต." or "อำเภอ". */
export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((w) => w.replace(PREFIX, ''))
    .filter(Boolean);
}

/** Search the built-in list. Every word must match the place or one of its parents. */
export function searchAdmin(list: Entry[], query: string, limit = 6): SearchResult[] {
  const tokens = searchTokens(query);
  if (!tokens.length || tokens[0].length < 2) return [];
  const lang = getLang();
  const scored: { e: Entry; score: number }[] = [];
  for (const e of list) {
    if (!tokens.every((tk) => e.hay.includes(tk))) continue;
    const first = tokens[0];
    const exact = e.own.some((n) => n === first);
    const prefix = e.own.some((n) => n.startsWith(first));
    const inOwn = e.own.some((n) => n.includes(first));
    // The place's own name matters most; larger areas come first when equally good.
    const score = (exact ? 100 : prefix ? 60 : inOwn ? 30 : 0) + (2 - e.level) * 5 - e.own[0].length * 0.1;
    scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ e }) => ({
    name: e[lang].name,
    detail: e[lang].detail,
    lat: Math.round(e.lat * 1e4) / 1e4,
    lng: Math.round(e.lng * 1e4) / 1e4,
    source: 'admin' as const,
  }));
}

// ---- Named places: Longdo Map straight from the browser, OpenStreetMap through our API as fallback ----

let longdoKey: Promise<string | null> | null = null;

/** The Longdo key comes from our API at run time; it is restricted to this site's domain by Longdo. */
function getLongdoKey(): Promise<string | null> {
  if (!longdoKey) {
    longdoKey = fetch('/api/config')
      .then((r) => r.json() as Promise<{ longdo_key?: string | null }>)
      .then((c) => c.longdo_key ?? null)
      .catch(() => null);
  }
  return longdoKey;
}

async function searchLongdo(q: string, key: string): Promise<SearchResult[]> {
  // A plain GET without custom headers: no CORS preflight.
  const res = await fetch(`${LONGDO_SEARCH_URL}?keyword=${encodeURIComponent(q)}&limit=8&locale=${getLang()}&key=${encodeURIComponent(key)}`);
  // Tell our server one Longdo request was made, so the admin page can estimate quota use.
  void fetch('/api/usage/longdo', { method: 'POST', headers: { 'x-fm-usage': '1' }, keepalive: true }).catch(() => {});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseLongdo(JSON.parse(await res.text()));
}

async function searchFallback(q: string): Promise<SearchResponse> {
  try {
    return (await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json()) as SearchResponse;
  } catch {
    return { q, results: [], error: 'network' };
  }
}

const remote = new Map<string, Promise<SearchResponse>>();

export function searchPlaces(query: string): Promise<SearchResponse> {
  const q = query.replace(/\s+/g, ' ').trim();
  const cacheKey = `${getLang()}:${q}`;
  let hit = remote.get(cacheKey);
  if (!hit) {
    hit = (async (): Promise<SearchResponse> => {
      const key = await getLongdoKey();
      if (key) {
        try {
          const results = await searchLongdo(q, key);
          if (results.length) return { q, provider: 'longdo', results };
        } catch {
          /* Longdo unavailable, over quota or changed: use the fallback */
        }
      }
      return searchFallback(q);
    })();
    remote.set(cacheKey, hit);
    if (remote.size > 60) remote.delete(remote.keys().next().value as string);
  }
  return hit;
}

// ---- Pasted coordinates or a Google Maps link ----

/** True when the text is a link or coordinates rather than a name to search for. */
export function looksPasted(text: string): boolean {
  return extractUrl(text) != null || parsePasted(text) != null;
}

/**
 * Position from pasted coordinates or a Google Maps link. Full links and coordinates are read
 * in the browser; a short share link is followed once by our server.
 */
export async function resolvePasted(text: string): Promise<PastedPlace | null> {
  const direct = parsePasted(text);
  if (direct) return direct;
  const short = shortLinkIn(text);
  if (!short) return null;
  try {
    const res = await fetch(`/api/maplink?u=${encodeURIComponent(short)}`);
    if (!res.ok) return null;
    const p = (await res.json()) as PastedPlace;
    return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null;
  } catch {
    return null;
  }
}
