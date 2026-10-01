import type { Reading } from '../../shared/types';

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface Near {
  reading: Reading;
  km: number;
}

/** Readings within `maxKm` of the point, nearest first, at most `limit`. */
export function nearby(items: Reading[], lat: number, lng: number, maxKm: number, limit = 1): Near[] {
  // Cheap bounding-box filter before the exact distance.
  const dLat = maxKm / 111;
  const dLng = maxKm / (111 * Math.cos(rad(lat)));
  const out: Near[] = [];
  for (const r of items) {
    if (Math.abs(r.lat - lat) > dLat || Math.abs(r.lng - lng) > dLng) continue;
    const km = distanceKm(lat, lng, r.lat, r.lng);
    if (km <= maxKm) out.push({ reading: r, km });
  }
  out.sort((a, b) => a.km - b.km);
  return out.slice(0, limit);
}

/** Search radius per layer when looking for monitoring points near a place. */
export const RADIUS_KM = { rain: 20, water: 30, road: 3, highway: 20, cctv: 2 } as const;

/** Bangkok bounding box: the only area with road flood sensors. */
export function inBangkokArea(lat: number, lng: number): boolean {
  return lat >= 13.49 && lat <= 13.96 && lng >= 100.32 && lng <= 100.94;
}

export function inThailand(lat: number, lng: number): boolean {
  return lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106;
}
