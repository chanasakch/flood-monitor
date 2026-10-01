import type { ForecastHour } from '../../shared/types';
import { assertFormat, fetchJson } from '../lib/http';
import { bkkLocalToIso } from '../lib/time';
import { num } from './util';

const URL_FORECAST = 'https://api.open-meteo.com/v1/forecast';

/** Normalise Open-Meteo hourly precipitation (mm) and precipitation probability (%). Times are Thai local. */
export function parseOpenMeteo(json: unknown): ForecastHour[] {
  const j = json as { utc_offset_seconds?: number; hourly?: Record<string, unknown[]> };
  const h = j?.hourly;
  assertFormat(h && Array.isArray(h.time), 'hourly.time is not an array');
  assertFormat(j.utc_offset_seconds === 25200, 'response is not in Asia/Bangkok time');
  const out: ForecastHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const time = bkkLocalToIso(String(h.time[i]));
    if (!time) continue;
    const mm = num(h.precipitation?.[i]);
    const prob = num(h.precipitation_probability?.[i]);
    out.push({
      time,
      mm: mm != null && mm >= 0 ? mm : null,
      prob: prob != null && prob >= 0 && prob <= 100 ? prob : null,
    });
  }
  assertFormat(out.length > 0, 'forecast has no hours');
  return out;
}

export async function fetchOpenMeteo(lat: number, lng: number): Promise<ForecastHour[]> {
  const url =
    `${URL_FORECAST}?latitude=${lat}&longitude=${lng}` +
    '&hourly=precipitation,precipitation_probability&timezone=Asia%2FBangkok&forecast_days=3';
  return parseOpenMeteo(await fetchJson(url, { timeoutMs: 12000 }));
}
