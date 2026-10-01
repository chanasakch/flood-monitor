import type { Level, LayerType } from '../../shared/types';
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

/** How many nearest points of each kind count towards the overall status and are listed on the detail page. */
const CONSIDER = 2;

export function summarizePlace(lat: number, lng: number, layers: Layers, now: number): PlaceSummary {
  const near = (type: LayerType, n: number): Near[] => nearby(layers[type]?.items ?? [], lat, lng, RADIUS_KM[type], n);
  const rain = near('rain', CONSIDER);
  const water = near('water', CONSIDER);
  const road = near('road', CONSIDER);
  const highway = near('highway', 5);
  const cctv = near('cctv', 6);
  // The overall status takes the worst fresh level among all of these, so an alert at the
  // second-nearest station is not hidden by a calm nearest one.
  const considered = [...rain, ...water, ...road, ...highway].map((n) => shown(n.reading, now).level);
  return { rain, water, road, highway, cctv, roadApplies: road.length > 0 || inBangkokArea(lat, lng), overall: worstLevel(considered) };
}

const RANK: Record<Level, number> = { unknown: 0, normal: 1, watch: 2, danger: 3 };

/** The point to feature on a card: the one with the worst level, the nearest when they tie. */
export function mostSerious(list: Near[], now: number): Near | undefined {
  let best: Near | undefined;
  let bestRank = -1;
  for (const n of list) {
    const rank = RANK[shown(n.reading, now).level];
    if (rank > bestRank) {
      best = n;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * True when a layer has nothing to show because its source has not delivered: failed to load,
 * never fetched, or failing with no stored data. Used to say "source unavailable" rather than
 * "no station nearby", which would be wrong.
 */
export function layerDown(layers: Layers, type: LayerType): boolean {
  const l = layers[type];
  return !l || (l.items.length === 0 && (!l.fetched_at || (l.status?.consecutive_failures ?? 0) > 0));
}

/** Layers whose source is currently failing, for the "source unavailable" notice. */
export function failingSources(layers: Layers): Layer[] {
  // The camera directory is not sensor data: when it is down, its own card says so instead of a page-wide warning.
  return Object.values(layers).filter((l): l is Layer => !!l && l.type !== 'cctv' && (l.status?.consecutive_failures ?? 0) > 0);
}
