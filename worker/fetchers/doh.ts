import { highwayLevel } from '../../shared/levels';
import { SOURCES } from '../../shared/sources';
import type { Reading } from '../../shared/types';
import { assertFormat, fetchJson } from '../lib/http';
import { anyIsoToBkkIso, bkkDate } from '../lib/time';
import { inThailandArea, num, scrubPhones, text } from './util';

const URL_DASHBOARD = 'https://hdms.doh.go.th/internal-api/public/dashboard';

/** "10-15" -> 15, "30" -> 30, "" -> null. The largest number in the text, in cm. */
export function parseDepthText(s: unknown): number | null {
  if (typeof s !== 'string' && typeof s !== 'number') return null;
  const nums = String(s).match(/\d+(?:\.\d+)?/g);
  if (!nums) return null;
  const max = Math.max(...nums.map(Number));
  return Number.isFinite(max) && max >= 0 && max <= 1000 ? max : null;
}

/**
 * Normalise the Department of Highways public dashboard. Only incidents that are still open and
 * published are kept. `lane_closure` is the dashboard's "passable" flag (true = passable).
 * Reporter names, phone numbers and free-text remarks are never copied.
 */
export function parseHighway(json: unknown): Reading[] {
  assertFormat(Array.isArray(json), 'dashboard response is not an array');
  const out: Reading[] = [];
  for (const row of json as Record<string, any>[]) {
    if (!row || row.gid == null) continue;
    if (row.end_date || row.publish === false || row.status === false) continue;
    const lat = num(row.latitude);
    const lng = num(row.longitude);
    if (lat == null || lng == null || !inThailandArea(lat, lng)) continue;
    const passable = typeof row.lane_closure === 'boolean' ? row.lane_closure : null;
    const typeId = num(row.incident_type_id);
    const depthText = text(typeof row.flood_level === 'number' ? String(row.flood_level) : row.flood_level);
    const name = scrubPhones(text(row.case_name) ?? '') || `ทล. ${text(row.road_code) ?? ''}`.trim();
    out.push({
      id: `highway:${row.gid}`,
      type: 'highway',
      lat,
      lng,
      value: typeId === 1 ? parseDepthText(depthText) : null,
      unit: 'cm',
      level: highwayLevel(passable),
      observed_at: anyIsoToBkkIso(row.report_date) ?? anyIsoToBkkIso(row.approved_date) ?? anyIsoToBkkIso(row.start_date),
      source: 'doh-hdms',
      source_url: SOURCES['doh-hdms'].url,
      name_th: name,
      name_en: null,
      extra: {
        type_id: typeId,
        type_th: text(row.incident_type_text),
        passable,
        reason: passable === false ? text(row.road_closure_text) : null,
        depth_text: typeId === 1 ? depthText : null,
        road: text(row.road_code)?.replace(/^0+/, '') ?? null,
        km_start: text(row.km_start),
        km_end: text(row.km_end),
        province_th: text(row.province),
        started_at: anyIsoToBkkIso(row.start_date),
      },
    });
  }
  return out;
}

export async function fetchHighway(nowMs: number = Date.now()): Promise<Reading[]> {
  // The date range selects incidents active in that window; open incidents that started earlier are included.
  const url = `${URL_DASHBOARD}?start=${bkkDate(nowMs, -1)}&end=${bkkDate(nowMs)}`;
  return parseHighway(await fetchJson(url, { timeoutMs: 28000, headers: { referer: SOURCES['doh-hdms'].url } }));
}
