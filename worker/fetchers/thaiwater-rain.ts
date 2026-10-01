import { rainLevel } from '../../shared/levels';
import { SOURCES } from '../../shared/sources';
import type { HistoryPoint, Reading } from '../../shared/types';
import { assertFormat, fetchJson } from '../lib/http';
import { bkkLocalToIso } from '../lib/time';
import { inThailandArea, num, text } from './util';

const URL_LATEST = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h';
const URL_GRAPH = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h_graph';

/** Normalise the ThaiWater `rain_24h` response. Value is the 24 h accumulation in mm. */
export function parseRain(json: unknown): Reading[] {
  const data = (json as { data?: unknown })?.data;
  assertFormat(Array.isArray(data), 'rain_24h.data is not an array');
  const byId = new Map<string, Reading>();
  for (const row of data as Record<string, any>[]) {
    const st = row?.station;
    const lat = num(st?.tele_station_lat);
    const lng = num(st?.tele_station_long);
    if (st?.id == null || lat == null || lng == null || !inThailandArea(lat, lng)) continue;
    const r24 = num(row.rain_24h);
    const id = `rain:${st.id}`;
    byId.set(id, {
      id,
      type: 'rain',
      lat,
      lng,
      value: r24,
      unit: 'mm',
      level: rainLevel(r24),
      observed_at: bkkLocalToIso(row.rainfall_datetime),
      source: 'thaiwater-rain',
      source_url: SOURCES['thaiwater-rain'].url,
      name_th: text(st.tele_station_name?.th) ?? text(st.tele_station_name?.en) ?? String(st.id),
      name_en: text(st.tele_station_name?.en),
      extra: {
        rain_1h: num(row.rain_1h),
        province_code: text(row.geocode?.province_code),
        agency: text(row.agency?.agency_shortname?.th),
      },
    });
  }
  assertFormat(byId.size > 0, 'rain_24h has no usable stations');
  return [...byId.values()];
}

export async function fetchRain(): Promise<Reading[]> {
  return parseRain(await fetchJson(URL_LATEST, { timeoutMs: 28000 }));
}

/** Hourly rain (mm in each hour) for one station. The upstream returns about two days. */
export function parseRainGraph(json: unknown): HistoryPoint[] {
  const data = (json as { data?: unknown })?.data;
  assertFormat(Array.isArray(data), 'rain_24h_graph.data is not an array');
  const out: HistoryPoint[] = [];
  for (const p of data as Record<string, any>[]) {
    const time = bkkLocalToIso(p?.rainfall_datetime);
    if (time) out.push({ time, value: num(p.rainfall_value) });
  }
  return out;
}

export async function fetchRainGraph(stationId: string, startDate: string, endDate: string): Promise<HistoryPoint[]> {
  const url = `${URL_GRAPH}?station_id=${encodeURIComponent(stationId)}&start_date=${startDate}&end_date=${endDate}`;
  return parseRainGraph(await fetchJson(url));
}
