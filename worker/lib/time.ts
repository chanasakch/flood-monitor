// All upstream sources report Thai local time (UTC+7, no daylight saving) unless noted.

const BKK_OFFSET_MS = 7 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

/** Format an instant as ISO 8601 in Asia/Bangkok, e.g. 2026-10-01T15:00:00+07:00. */
export function toBkkIso(ms: number): string {
  const d = new Date(ms + BKK_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+07:00`
  );
}

/** "2026-10-01 15:00" or "2026-10-01T15:00[:00]" in Thai local time -> ISO with +07:00. Null if malformed. */
export function bkkLocalToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+07:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** "2026-10-01 09:45" in UTC -> ISO in Asia/Bangkok. Null if malformed. */
export function utcLocalToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`);
  return Number.isNaN(ms) ? null : toBkkIso(ms);
}

/** .NET JSON date "/Date(1790405100083)/" -> ISO in Asia/Bangkok. Null if malformed. */
export function dotnetDateToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /\/Date\((-?\d+)\)\//.exec(s);
  if (!m) return null;
  const ms = Number(m[1]);
  return Number.isFinite(ms) && ms > 0 ? toBkkIso(ms) : null;
}

/** Any ISO string a source gives (with Z or offset) -> ISO in Asia/Bangkok. Null if malformed. */
export function anyIsoToBkkIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : toBkkIso(ms);
}

/** Calendar date in Asia/Bangkok, YYYY-MM-DD, optionally shifted by whole days. */
export function bkkDate(nowMs: number, shiftDays = 0): string {
  return toBkkIso(nowMs + shiftDays * 86400000).slice(0, 10);
}
