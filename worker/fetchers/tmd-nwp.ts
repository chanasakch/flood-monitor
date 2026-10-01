import type { ForecastHour } from '../../shared/types';
import { assertFormat, fetchJson } from '../lib/http';
import { anyIsoToBkkIso } from '../lib/time';
import { num } from './util';

const URL_HOURLY = 'https://data.tmd.go.th/nwpapi/v1/forecast/location/hourly/at';

/** Normalise the TMD NWP hourly forecast: rain in mm for each hour and the condition code. No probability exists. */
export function parseTmdHourly(json: unknown): ForecastHour[] {
  const forecasts = (json as { WeatherForecasts?: { forecasts?: unknown }[] })?.WeatherForecasts?.[0]?.forecasts;
  assertFormat(Array.isArray(forecasts), 'WeatherForecasts[0].forecasts is not an array');
  const out: ForecastHour[] = [];
  for (const f of forecasts as Record<string, any>[]) {
    const time = anyIsoToBkkIso(f?.time);
    if (!time) continue;
    const mm = num(f.data?.rain);
    out.push({ time, mm: mm != null && mm >= 0 ? mm : null, cond: num(f.data?.cond) });
  }
  assertFormat(out.length > 0, 'forecast has no hours');
  return out;
}

export async function fetchTmdHourly(lat: number, lng: number, token: string): Promise<ForecastHour[]> {
  const url = `${URL_HOURLY}?lat=${lat}&lon=${lng}&fields=rain,cond&duration=48`;
  return parseTmdHourly(
    await fetchJson(url, { timeoutMs: 12000, headers: { accept: 'application/json', authorization: `Bearer ${token}` } }),
  );
}
