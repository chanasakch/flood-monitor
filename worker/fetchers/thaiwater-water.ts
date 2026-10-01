import { waterLevel } from '../../shared/levels';
import type { HistoryPoint, Reading } from '../../shared/types';
import { assertFormat, fetchJson } from '../lib/http';
import { bkkLocalToIso } from '../lib/time';
import { inThailandArea, num, text } from './util';

const URL_LATEST = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load';
const URL_GRAPH = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_graph';
const stationUrl = (id: string | number) => `https://www.thaiwater.net/water/station/dataindex/tele_wl/${id}`;

/**
 * Normalise the ThaiWater `waterlevel_load` response. Value is the water level in metres above
 * mean sea level; the alert level comes from the agency's own `situation_level` (1-5).
 */
export function parseWater(json: unknown): Reading[] {
  const data = (json as { waterlevel_data?: { data?: unknown } })?.waterlevel_data?.data;
  assertFormat(Array.isArray(data), 'waterlevel_load.waterlevel_data.data is not an array');
  const byId = new Map<string, Reading>();
  for (const row of data as Record<string, any>[]) {
    const st = row?.station;
    const lat = num(st?.tele_station_lat);
    const lng = num(st?.tele_station_long);
    if (st?.id == null || lat == null || lng == null || !inThailandArea(lat, lng)) continue;
    const situation = num(row.situation_level);
    const id = `water:${st.id}`;
    byId.set(id, {
      id,
      type: 'water',
      lat,
      lng,
      value: num(row.waterlevel_msl),
      unit: 'm MSL',
      level: waterLevel(situation),
      observed_at: bkkLocalToIso(row.waterlevel_datetime),
      source: 'thaiwater-water',
      source_url: stationUrl(st.id),
      name_th: text(st.tele_station_name?.th) ?? text(st.tele_station_name?.en) ?? String(st.id),
      name_en: text(st.tele_station_name?.en),
      extra: {
        situation,
        storage_percent: num(row.storage_percent),
        bank: num(st.min_bank),
        ground: num(st.ground_level),
        river: text(row.river_name),
        province_code: text(row.geocode?.province_code),
        agency: text(row.agency?.agency_shortname?.th),
      },
    });
  }
  assertFormat(byId.size > 0, 'waterlevel_load has no usable stations');
  return [...byId.values()];
}

export async function fetchWater(): Promise<Reading[]> {
  return parseWater(await fetchJson(URL_LATEST, { timeoutMs: 28000 }));
}

export interface WaterGraph {
  points: HistoryPoint[];
  thresholds: { bank: number | null; ground: number | null };
}

export function parseWaterGraph(json: unknown): WaterGraph {
  const data = (json as { data?: Record<string, any> })?.data;
  assertFormat(data && Array.isArray(data.graph_data), 'waterlevel_graph.data.graph_data is not an array');
  const points: HistoryPoint[] = [];
  for (const p of data.graph_data as Record<string, any>[]) {
    const time = bkkLocalToIso(p?.datetime);
    if (time) points.push({ time, value: num(p.value) });
  }
  return { points, thresholds: { bank: num(data.min_bank), ground: num(data.ground_level) } };
}

export async function fetchWaterGraph(stationId: string, startDate: string, endDate: string): Promise<WaterGraph> {
  const url = `${URL_GRAPH}?station_type=tele_waterlevel&station_id=${encodeURIComponent(stationId)}&start_date=${startDate}&end_date=${endDate}`;
  return parseWaterGraph(await fetchJson(url));
}
