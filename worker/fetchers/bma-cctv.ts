import type { Reading } from '../../shared/types';
import { assertFormat, fetchUpstream } from '../lib/http';
import { inThailandArea, text } from './util';

const URL_INDEX = 'http://www.bmatraffic.com/index.aspx';
const cameraUrl = (id: string) => `http://www.bmatraffic.com/PlayVideo.aspx?ID=${id}`;

// One camera per line inside `var locations = [ ... ];`:
// ['603','BR-05-01 name','Name en','direction th','direction en',13.7262,100.52797,'10.x.x.x','pin.png'],
const ROW = /\[\s*'(\d+)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g;

/**
 * Extract the camera directory from the BMA traffic page. Only position and names are kept:
 * the camera's internal IP address in the page is deliberately dropped. Images are not fetched;
 * `source_url` points at the official page for each camera.
 */
export function parseCctv(html: string): Reading[] {
  const start = html.indexOf('var locations = [');
  assertFormat(start >= 0, 'camera list `var locations` not found');
  const end = html.indexOf('];', start);
  const block = html.slice(start, end > start ? end : undefined);
  const byId = new Map<string, Reading>();
  for (const m of block.matchAll(ROW)) {
    const lat = Number(m[6]);
    const lng = Number(m[7]);
    if (!inThailandArea(lat, lng)) continue;
    const id = m[1];
    // Names start with an internal code such as "BR-05-01 "; show the place name only.
    const raw = text(m[2]) ?? '';
    const nameTh = raw.replace(/^[A-Z0-9]+(?:-[A-Z0-9]+)+\s*/i, '') || text(m[4]) || raw || id;
    byId.set(`cctv:${id}`, {
      id: `cctv:${id}`,
      type: 'cctv',
      lat,
      lng,
      value: null,
      unit: '',
      level: 'unknown',
      observed_at: null,
      source: 'bma-cctv',
      source_url: cameraUrl(id),
      name_th: nameTh,
      name_en: text(m[3]),
      extra: { direction_th: text(m[4]), direction_en: text(m[5]) },
    });
  }
  assertFormat(byId.size > 0, 'camera list is empty');
  return [...byId.values()];
}

export async function fetchCctv(): Promise<Reading[]> {
  const res = await fetchUpstream(URL_INDEX, { timeoutMs: 28000, headers: { accept: 'text/html' } });
  return parseCctv(await res.text());
}
