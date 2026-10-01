/** Finite number from a number or numeric string, otherwise null. Never guesses. */
export function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** Trimmed non-empty string, otherwise null. Collapses tabs and repeated spaces. */
export function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s !== '-' ? s : null;
}

/** Loose box around Thailand; rejects obviously wrong coordinates such as 0,0 or swapped lat/lng. */
export function inThailandArea(lat: number, lng: number): boolean {
  return lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106;
}

const PHONE = /0[689]\d[-\s]?\d{3}[-\s]?\d{4}|0[689]\d{8}|0\d[-\s]?\d{3}[-\s]?\d{4}/g;

/** Remove phone numbers from free text published by an agency, so personal contacts are not re-published. */
export function scrubPhones(s: string): string {
  return s.replace(PHONE, '').replace(/\s{2,}/g, ' ').trim();
}

export function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
