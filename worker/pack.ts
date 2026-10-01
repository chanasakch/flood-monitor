import type { PackedReading, Reading } from '../shared/types';

const FACTORABLE = ['type', 'unit', 'source', 'source_url', 'name_en', 'observed_at', 'level'] as const;

export interface PackedLayer {
  defaults: Partial<Reading>;
  items: PackedReading[];
}

/**
 * Shrink a layer for storage and transfer: a field that has the same value on every reading is
 * sent once in `defaults`. `unpackLayer` restores the full common schema. Nothing is dropped.
 */
export function packLayer(readings: Reading[]): PackedLayer {
  const defaults: Record<string, unknown> = {};
  if (readings.length > 1) {
    for (const key of FACTORABLE) {
      const first = readings[0][key];
      if (readings.every((r) => r[key] === first)) defaults[key] = first;
    }
  }
  const items = readings.map((r) => {
    const item: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (k in defaults) continue;
      if (k === 'name_en' && v == null) continue; // restored as null by unpackLayer
      item[k] = v;
    }
    return item as unknown as PackedReading;
  });
  return { defaults: defaults as Partial<Reading>, items };
}

export function unpackLayer(layer: PackedLayer): Reading[] {
  return layer.items.map((item) => ({ name_en: null, ...layer.defaults, ...item }) as Reading);
}
