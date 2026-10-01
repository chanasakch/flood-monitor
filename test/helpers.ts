import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Reading } from '../shared/types';

const dir = fileURLToPath(new URL('../fixtures/', import.meta.url));

export const fixtureText = (name: string): string => readFileSync(dir + name, 'utf8');
export const fixtureJson = (name: string): unknown => JSON.parse(fixtureText(name));
export const fixtureBytes = (name: string): Uint8Array => new Uint8Array(readFileSync(dir + name));

const ISO_BKK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/;

/** Every reading must satisfy the common schema, whatever the source. */
export function expectCommonSchema(readings: Reading[], type: Reading['type'], source: Reading['source']): void {
  const ids = new Set<string>();
  for (const r of readings) {
    if (r.type !== type) throw new Error(`${r.id}: type ${r.type}`);
    if (r.source !== source) throw new Error(`${r.id}: source ${r.source}`);
    if (!r.id.startsWith(`${type}:`)) throw new Error(`${r.id}: id prefix`);
    if (ids.has(r.id)) throw new Error(`${r.id}: duplicate id`);
    ids.add(r.id);
    if (!(r.lat >= 5 && r.lat <= 21 && r.lng >= 97 && r.lng <= 106)) throw new Error(`${r.id}: coordinates ${r.lat},${r.lng}`);
    if (r.value !== null && !Number.isFinite(r.value)) throw new Error(`${r.id}: value ${r.value}`);
    if (!['normal', 'watch', 'danger', 'unknown'].includes(r.level)) throw new Error(`${r.id}: level ${r.level}`);
    if (r.observed_at !== null && !ISO_BKK.test(r.observed_at)) throw new Error(`${r.id}: observed_at ${r.observed_at}`);
    if (!/^https?:\/\//.test(r.source_url)) throw new Error(`${r.id}: source_url ${r.source_url}`);
    if (!r.name_th) throw new Error(`${r.id}: name_th empty`);
  }
}
