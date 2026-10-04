import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGazetteer, searchAdmin, searchTokens, type Gazetteer } from '../src/lib/search';
import { parsePhoton } from '../worker/fetchers/photon';
import { FormatError } from '../worker/lib/http';
import { fixtureJson } from './helpers';

const gazetteer = JSON.parse(readFileSync(decodeURIComponent(new URL('../public/gazetteer.json', import.meta.url).pathname), 'utf8')) as Gazetteer;
const list = buildGazetteer(gazetteer);

describe('built-in place list', () => {
  it('covers every province, district and subdistrict inside Thailand', () => {
    expect(gazetteer.p.length).toBe(77);
    expect(gazetteer.a.length).toBeGreaterThan(900);
    expect(gazetteer.t.length).toBeGreaterThan(7000);
    for (const e of list) {
      expect(e.lat).toBeGreaterThan(5);
      expect(e.lat).toBeLessThan(21);
      expect(e.lng).toBeGreaterThan(97);
      expect(e.lng).toBeLessThan(106);
    }
  });

  it('ignores administrative prefixes in the query', () => {
    expect(searchTokens('ต.บางกะปิ อ.ห้วยขวาง')).toEqual(['บางกะปิ', 'ห้วยขวาง']);
    expect(searchTokens('  จังหวัดเชียงใหม่ ')).toEqual(['เชียงใหม่']);
  });

  it('finds a province first when its name is typed', () => {
    const r = searchAdmin(list, 'เชียงใหม่');
    expect(r[0]).toMatchObject({ name: 'จ.เชียงใหม่', source: 'admin' });
    expect(r[0].lat).toBeGreaterThan(18);
  });

  it('uses Bangkok wording for districts and subdistricts', () => {
    const r = searchAdmin(list, 'บางกะปิ');
    expect(r.map((x) => x.name)).toContain('เขตบางกะปิ');
    expect(r.find((x) => x.name === 'เขตบางกะปิ')!.detail).toBe('กรุงเทพมหานคร');
  });

  it('narrows by district and province when several words are typed', () => {
    const r = searchAdmin(list, 'ดอนนางหงส์ นครพนม');
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ name: 'ต.ดอนนางหงส์', detail: 'อ.ธาตุพนม จ.นครพนม', lat: 17.0934, lng: 104.7416 });
  });

  it('matches English district and province names', () => {
    expect(searchAdmin(list, 'that phanom')[0].name).toBe('อ.ธาตุพนม');
  });

  it('returns nothing for very short or unknown queries', () => {
    expect(searchAdmin(list, 'ก')).toEqual([]);
    expect(searchAdmin(list, 'zzzzqqq')).toEqual([]);
  });
});

describe('Photon place search', () => {
  const results = parsePhoton(fixtureJson('photon-search.json'));

  it('keeps named places inside Thailand with a short location', () => {
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({ name: 'โรงเรียนสตรีวิทยา', source: 'osm' });
    expect(results[0].detail).toContain('พระนคร');
    for (const r of results) {
      expect(r.lat).toBeGreaterThan(5);
      expect(r.lat).toBeLessThan(21);
    }
  });

  it('drops places outside Thailand and unnamed results', () => {
    const json = {
      features: [
        { properties: { name: 'Paris', countrycode: 'FR' }, geometry: { coordinates: [2.35, 48.85] } },
        { properties: { countrycode: 'TH' }, geometry: { coordinates: [100.5, 13.7] } },
        { properties: { name: 'ตลาด', countrycode: 'TH' }, geometry: { coordinates: [100.5, 13.7] } },
      ],
    };
    expect(parsePhoton(json).map((r) => r.name)).toEqual(['ตลาด']);
  });

  it('rejects a changed format', () => {
    expect(() => parsePhoton({ message: 'error' })).toThrow(FormatError);
  });
});

import { parseLongdo } from '../worker/fetchers/longdo';

describe('Longdo place search', () => {
  it('keeps named places inside Thailand and accepts numbers given as text', () => {
    const json = {
      meta: { keyword: 'โรงแรม' },
      data: [
        { id: 'A1', name: 'โรงแรมตัวอย่าง', address: 'ถนนสีลม บางรัก กรุงเทพมหานคร', lat: 13.7246, lon: 100.5286 },
        { id: 'A2', name: 'คอนโดตัวอย่าง', address: '', lat: '13.80', lon: '100.56' },
        { id: 'A3', name: '', lat: 13.7, lon: 100.5 },
        { id: 'A4', name: 'Outside', lat: 35.6, lon: 139.7 },
        { id: 'A5', name: 'โรงแรมตัวอย่าง', lat: 13.72461, lon: 100.52861 },
      ],
    };
    const r = parseLongdo(json);
    expect(r.map((x) => x.name)).toEqual(['โรงแรมตัวอย่าง', 'คอนโดตัวอย่าง']);
    expect(r[0]).toEqual({ name: 'โรงแรมตัวอย่าง', detail: 'ถนนสีลม บางรัก กรุงเทพมหานคร', lat: 13.7246, lng: 100.5286, source: 'longdo' });
    expect(r[1].lat).toBe(13.8);
  });

  it('parses a real response (fixture) into name, address and position', () => {
    const r = parseLongdo(fixtureJson('longdo-search.json'));
    expect(r[0]).toEqual({
      name: 'โรงแรมแมนดารินโอเรียนเต็ล เจริญกรุง',
      detail: '48 ถนนเจริญกรุง แขวงบางรัก เขตบางรัก กรุงเทพมหานคร 10500',
      lat: 13.72379,
      lng: 100.51399,
      source: 'longdo',
    });
  });

  it('skips places marked as no longer existing', () => {
    expect(parseLongdo({ data: [{ name: 'ร้านที่ปิดแล้ว', lat: 13.7, lon: 100.5, obsoleted: true }] })).toEqual([]);
  });

  it('rejects an answer without a result list, such as a key error', () => {
    expect(() => parseLongdo({ error: 'key' })).toThrow(FormatError);
    expect(() => parseLongdo(null)).toThrow(FormatError);
  });
});
