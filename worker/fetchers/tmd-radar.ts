import { assertFormat, fetchUpstream } from '../lib/http';
import { utcLocalToIso } from '../lib/time';

const BASE = 'https://weather.tmd.go.th/composite/';
const MAX_BYTES = 1_500_000; // D1 values are limited to 2 MB; real frames are 30-150 KB.

export interface RadarFrame {
  /** Observation time, ISO in Asia/Bangkok. */
  observed_at: string;
  /** Path of the overlay image relative to `images/`, e.g. "zr/24.png". */
  file: string;
}

/**
 * Parse `images_composite.list`. Lines look like
 * `background_THA.png "2026-10-01 09:45" overlay=zr/24.png` with the time in UTC.
 * Returns the newest frame.
 */
export function parseRadarList(listText: string): RadarFrame {
  let latest: RadarFrame | null = null;
  for (const line of listText.split('\n')) {
    const m = /^\S+\s+"([^"]+)"\s+overlay=(.+)$/.exec(line.trim());
    if (!m) continue;
    const observed = utcLocalToIso(m[1]);
    const overlay = m[2]
      .split(',')
      .map((s) => s.trim())
      .find((f) => /^(zr\/)?\d{2}\.png$/i.test(f));
    if (!observed || !overlay) continue;
    const file = overlay.includes('/') ? overlay : `zr/${overlay}`;
    if (!latest || Date.parse(observed) > Date.parse(latest.observed_at)) latest = { observed_at: observed, file };
  }
  assertFormat(latest, 'no radar frame found in images_composite.list');
  return latest;
}

export async function fetchRadarList(): Promise<RadarFrame> {
  const res = await fetchUpstream(`${BASE}images_composite.list?_=${Date.now()}`, { headers: { accept: 'text/plain' } });
  return parseRadarList(await res.text());
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/** Download one frame, unmodified. Rejects anything that is not a PNG of a sane size. */
export async function fetchRadarImage(frame: RadarFrame): Promise<ArrayBuffer> {
  const res = await fetchUpstream(`${BASE}images/${frame.file}?_=${Date.now()}`, { headers: { accept: 'image/png' } });
  const buf = await res.arrayBuffer();
  assertFormat(isPng(new Uint8Array(buf)), 'radar frame is not a PNG image');
  assertFormat(buf.byteLength <= MAX_BYTES, `radar frame too large (${buf.byteLength} bytes)`);
  return buf;
}
