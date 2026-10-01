import { roadLevel } from '../../shared/levels';
import { SOURCES } from '../../shared/sources';
import type { Reading } from '../../shared/types';
import { assertFormat, fetchJson } from '../lib/http';
import { dotnetDateToIso } from '../lib/time';
import { inThailandArea, num, text } from './util';

const URL_LATEST = 'https://weather.bangkok.go.th/Flood/PageMap/GetData?id=';
const PAGE = SOURCES['bma-road'].url;

function officialUrl(u: unknown): string {
  // Only link to the BMA's own pages; anything else falls back to the main flood page.
  return typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.bangkok\.go\.th\//i.test(u) ? u : PAGE;
}

function toReading(row: Record<string, any>, tunnel: boolean): Reading | null {
  const lat = num(row?.latitude);
  const lng = num(row?.longitude);
  if (row?.flood_id == null || lat == null || lng == null || !inThailandArea(lat, lng)) return null;
  const cm = num(row.flood);
  const sub = tunnel ? text(row.tunnel_sub_name) : null;
  const subEn = tunnel ? text(row.tunnel_sub_name_en) : null;
  const nameTh = text(row.flood_name) ?? text(row.flood_short_name) ?? text(row.flood_code) ?? String(row.flood_id);
  const nameEn = text(row.flood_name_en) ?? text(row.flood_short_name_en);
  return {
    id: `road:${tunnel ? 't' : ''}${row.flood_id}`,
    type: 'road',
    lat,
    lng,
    value: cm,
    unit: 'cm',
    level: roadLevel(cm),
    observed_at: dotnetDateToIso(row.site_timestamp),
    source: 'bma-road',
    source_url: officialUrl(row.web_url),
    name_th: sub ? `${nameTh} (${sub})` : nameTh,
    name_en: nameEn ? (subEn ? `${nameEn} (${subEn})` : nameEn) : null,
    extra: { code: text(row.flood_code), tunnel },
  };
}

/**
 * Normalise the BMA road flood response: road sensors (`floodTbl`) and underpass sensors
 * (`dtTblTunel`). Value is the water depth on the road surface in cm; null means the sensor is offline.
 */
export function parseRoad(json: unknown): Reading[] {
  const j = json as { floodTbl?: unknown; dtTblTunel?: unknown };
  assertFormat(Array.isArray(j?.floodTbl), 'GetData.floodTbl is not an array');
  const byId = new Map<string, Reading>();
  for (const row of j.floodTbl as Record<string, any>[]) {
    const r = toReading(row, false);
    if (r) byId.set(r.id, r);
  }
  if (Array.isArray(j.dtTblTunel)) {
    for (const row of j.dtTblTunel as Record<string, any>[]) {
      const r = toReading(row, true);
      if (r) byId.set(r.id, r);
    }
  }
  assertFormat(byId.size > 0, 'GetData has no usable sensors');
  return [...byId.values()];
}

export async function fetchRoad(): Promise<Reading[]> {
  return parseRoad(
    await fetchJson(URL_LATEST, {
      timeoutMs: 28000,
      headers: { referer: PAGE, 'x-requested-with': 'XMLHttpRequest' },
    }),
  );
}
