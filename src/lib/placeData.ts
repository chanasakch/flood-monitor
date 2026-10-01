import type { Level, LayerType, Reading } from '../../shared/types';
import { worstLevel } from '../../shared/levels';
import { getLayer, type Layer } from './api';
import { inBangkokArea, nearby, RADIUS_KM, type Near } from './geo';
import { shown } from './status';

export type Layers = Partial<Record<LayerType, Layer>>;

/** Load several layers at once. A layer that fails is simply absent; the others still show. */
export async function loadLayers(types: LayerType[]): Promise<{ layers: Layers; failed: LayerType[] }> {
  const results = await Promise.allSettled(types.map((type) => getLayer(type)));
  const layers: Layers = {};
  const failed: LayerType[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') layers[types[i]] = r.value;
    else failed.push(types[i]);
  });
  if (failed.length === types.length) throw results[0].status === 'rejected' ? results[0].reason : new Error('load failed');
  return { layers, failed };
}

export interface PlaceSummary {
  rain: Near[];
  water: Near[];
  road: Near[];
  highway: Near[];
  cctv: Near[];
  /** Whether a road-sensor row applies at all: only Bangkok has road sensors. */
  roadApplies: boolean;
  /** Worst level among fresh nearby readings. `unknown` when there are none: never "not flooded". */
  overall: Level;
}

export function summarizePlace(lat: number, lng: number, layers: Layers, now: number, limit = 1): PlaceSummary {
  const near = (type: LayerType, n: number): Near[] => nearby(layers[type]?.items ?? [], lat, lng, RADIUS_KM[type], n);
  const rain = near('rain', limit);
  const water = near('water', limit);
  const road = near('road', limit);
  const highway = near('highway', Math.max(limit, 5));
  const cctv = near('cctv', 6);
  const levelOf = (r: Reading) => shown(r, now).level;
  // The overall status looks at the single nearest point of each kind, plus every nearby highway report.
  const considered = [rain[0], water[0], road[0], ...highway].filter(Boolean).map((n) => levelOf(n.reading));
  return { rain, water, road, highway, cctv, roadApplies: road.length > 0 || inBangkokArea(lat, lng), overall: worstLevel(considered) };
}

/** Layers whose source is currently failing, for the "source unavailable" notice. */
export function failingSources(layers: Layers): Layer[] {
  return Object.values(layers).filter((l): l is Layer => !!l && (l.status?.consecutive_failures ?? 0) > 0);
}
