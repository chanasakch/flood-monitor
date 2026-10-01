import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import th from '../src/i18n/th.json';
import { displayLevel, freshness, rainClass, rainLevel, roadLevel, waterLevel, worstLevel } from '../shared/levels';
import { bkkDate, bkkLocalToIso, dotnetDateToIso, toBkkIso, utcLocalToIso } from '../worker/lib/time';

const NOW = Date.parse('2026-10-01T17:00:00+07:00');

describe('freshness', () => {
  it('is fresh inside the threshold and stale after it', () => {
    expect(freshness('2026-10-01T16:30:00+07:00', 60, NOW)).toBe('fresh');
    expect(freshness('2026-10-01T16:00:00+07:00', 60, NOW)).toBe('fresh');
    expect(freshness('2026-10-01T15:59:00+07:00', 60, NOW)).toBe('stale');
  });

  it('distrusts times in the future and missing times', () => {
    expect(freshness('2026-10-01T17:10:00+07:00', 60, NOW)).toBe('fresh');
    expect(freshness('2026-10-01T23:00:00+07:00', 60, NOW)).toBe('future');
    expect(freshness(null, 60, NOW)).toBe('unknown');
    expect(freshness('not a date', 60, NOW)).toBe('unknown');
  });

  it('never shows an alert colour for data that is not fresh', () => {
    expect(displayLevel('danger', 'stale')).toBe('unknown');
    expect(displayLevel('normal', 'future')).toBe('unknown');
    expect(displayLevel('watch', 'fresh')).toBe('watch');
  });
});

describe('level rules', () => {
  it('rain', () => {
    expect(rainLevel(null)).toBe('unknown');
    expect(rainLevel(0)).toBe('normal');
    expect(rainLevel(35)).toBe('normal');
    expect(rainLevel(35.1)).toBe('watch');
    expect(rainLevel(90.1)).toBe('danger');
    expect([rainClass(0), rainClass(5), rainClass(20), rainClass(50), rainClass(120), rainClass(null)]).toEqual([0, 1, 2, 3, 4, null]);
  });
  it('water and road', () => {
    expect([waterLevel(1), waterLevel(3), waterLevel(4), waterLevel(5), waterLevel(null)]).toEqual(['normal', 'normal', 'watch', 'danger', 'unknown']);
    expect([roadLevel(0), roadLevel(5), roadLevel(5.1), roadLevel(10), roadLevel(10.1), roadLevel(null)]).toEqual(['normal', 'normal', 'watch', 'watch', 'danger', 'unknown']);
  });
  it('worst level ignores unknown unless nothing else exists', () => {
    expect(worstLevel(['normal', 'unknown', 'watch'])).toBe('watch');
    expect(worstLevel(['unknown'])).toBe('unknown');
    expect(worstLevel([])).toBe('unknown');
  });
});

describe('time helpers', () => {
  it('converts source formats to ISO in Asia/Bangkok', () => {
    expect(bkkLocalToIso('2026-10-01 15:00')).toBe('2026-10-01T15:00:00+07:00');
    expect(bkkLocalToIso('garbage')).toBeNull();
    expect(utcLocalToIso('2026-10-01 09:45')).toBe('2026-10-01T16:45:00+07:00');
    expect(dotnetDateToIso('/Date(1790849100000)/')).toBe('2026-10-01T17:05:00+07:00');
    expect(dotnetDateToIso(null)).toBeNull();
    expect(toBkkIso(Date.parse('2026-12-31T18:30:00Z'))).toBe('2027-01-01T01:30:00+07:00');
    expect(bkkDate(Date.parse('2026-10-01T18:00:00Z'))).toBe('2026-10-02');
    expect(bkkDate(Date.parse('2026-10-01T18:00:00Z'), -1)).toBe('2026-10-01');
  });
});

describe('i18n', () => {
  const keys = (o: unknown, prefix = ''): string[] =>
    Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`)));

  it('Thai and English have exactly the same keys', () => {
    expect(keys(en).sort()).toEqual(keys(th).sort());
  });

  it('uses the same placeholders in both languages', () => {
    const get = (o: any, path: string) => path.split('.').reduce((n, p) => n[p], o) as string;
    for (const k of keys(th)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(get(en, k)), k).toEqual(ph(get(th, k)));
    }
  });

  it('carries the required footer text', () => {
    expect(th.footer.disclaimer).toBe('ใช้ประกอบการตัดสินใจเท่านั้น โปรดตรวจสอบประกาศทางการอีกครั้ง');
    expect(th.common.notCurrent).toBe('ข้อมูลไม่เป็นปัจจุบัน');
    expect(en.common.notCurrent).toBe('Data not current');
    expect(th.common.noData).toBe('ไม่มีข้อมูล');
    expect(en.common.noData).toBe('No data');
  });
});
