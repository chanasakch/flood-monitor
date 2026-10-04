import { describe, expect, it } from 'vitest';
import { ALERT_AREAS, composeAlert, composeQuotaNotice, decide, evaluateArea, monthlySendCap, type SentRow } from '../shared/alerts';
import type { ForecastHour, ForecastResponse } from '../shared/types';

const NOW = Date.parse('2026-10-04T15:10:00+07:00');
const area = ALERT_AREAS[0];
const iso = (h: number) => `2026-10-04T${String(h).padStart(2, '0')}:00:00+07:00`;
const fetched = new Date(NOW - 5 * 60000).toISOString();

function fc(tmd: ForecastHour[], om: ForecastHour[], opts: { tmdOk?: boolean; fetchedAt?: string } = {}): ForecastResponse {
  const f = opts.fetchedAt ?? fetched;
  return {
    lat: area.lat,
    lng: area.lng,
    primary: 'tmd-nwp',
    tmd: { ok: opts.tmdOk ?? true, source: 'tmd-nwp', source_url: '', fetched_at: f, hours: tmd },
    openmeteo: { ok: true, source: 'open-meteo', source_url: '', fetched_at: f, hours: om },
  };
}

describe('alert conditions', () => {
  it('stays quiet when nothing is expected in the next two hours', () => {
    expect(evaluateArea(area, fc([{ time: iso(16), mm: 0.2, cond: 3 }], [{ time: iso(16), mm: 0.1, prob: 40 }]), NOW)).toBeNull();
  });

  it('alerts when Open-Meteo gives a 60 % chance of rain', () => {
    const a = evaluateArea(area, fc([], [{ time: iso(16), mm: 0.4, prob: 65 }]), NOW)!;
    expect(a).toMatchObject({ kind: 'rain', prob: 65, atMs: Date.parse(iso(16)) });
  });

  it('prefers a TMD thunderstorm over plain rain, and heavy rain from 10 mm/h', () => {
    expect(evaluateArea(area, fc([{ time: iso(17), mm: 3, cond: 8 }], [{ time: iso(16), mm: 1, prob: 80 }]), NOW)!.kind).toBe('storm');
    expect(evaluateArea(area, fc([{ time: iso(16), mm: 12, cond: 6 }], []), NOW)!.kind).toBe('heavy');
    expect(evaluateArea(area, fc([{ time: iso(16), mm: 2, cond: 7 }], []), NOW)!.kind).toBe('heavy');
  });

  it('ignores hours beyond the two-hour window and stale forecasts', () => {
    expect(evaluateArea(area, fc([{ time: iso(19), mm: 30, cond: 8 }], [{ time: iso(19), mm: 30, prob: 100 }]), NOW)).toBeNull();
    const old = new Date(NOW - 4 * 3600000).toISOString();
    expect(evaluateArea(area, fc([{ time: iso(16), mm: 30, cond: 8 }], [], { fetchedAt: old }), NOW)).toBeNull();
  });

  it('counts the hour already under way', () => {
    expect(evaluateArea(area, fc([], [{ time: iso(15), mm: 1, prob: 90 }]), NOW)!.atMs).toBe(Date.parse(iso(15)));
  });
});

describe('alert message', () => {
  it('lists every area in one message, strongest first, with source and disclaimer', () => {
    const hits = [
      evaluateArea(ALERT_AREAS[0], fc([], [{ time: iso(16), mm: 1, prob: 70 }]), NOW)!,
      evaluateArea(ALERT_AREAS[3], fc([{ time: iso(15), mm: 5, cond: 8 }], []), NOW)!,
    ];
    const text = composeAlert(hits, NOW, 'https://example.test', 3, 48, ['กรมอุตุนิยมวิทยา', 'Open-Meteo']);
    const lines = text.split('\n');
    expect(lines[0]).toBe('⛈️ เตือนฝน · 15:10 น.');
    expect(lines[1]).toBe('• รามอินทรา: เสี่ยงพายุฝนฟ้าคะนอง ตอนนี้');
    expect(lines[2]).toBe('• มีนบุรี: โอกาสฝน 70% ช่วง 16:00 น.');
    expect(text).toContain('แจ้งเตือนครั้งที่ 3/48 ของเดือนนี้');
    expect(text).toContain('ใช้ประกอบการตัดสินใจเท่านั้น โปรดตรวจสอบประกาศทางการอีกครั้ง');
    expect(text).toContain('ที่มา: กรมอุตุนิยมวิทยา, Open-Meteo');
    expect(composeQuotaNotice(48, 'https://example.test')).toContain('ครบ 48 ครั้ง');
  });
});

describe('sending limits', () => {
  const sent = (isoTime: string, kind: SentRow['kind'] = 'alert', ok = 1): SentRow => ({ sent_at: new Date(isoTime).toISOString(), kind, ok });

  it('allows 48 sends a month for 6 people on the 300-message free plan', () => {
    expect(monthlySendCap(300, 6)).toBe(48);
    expect(monthlySendCap(300, 10)).toBe(28);
  });

  it('sends when nothing was sent recently', () => {
    expect(decide([], NOW, 48)).toEqual({ send: 'alert', sendNo: 1 });
  });

  it('waits 3 hours between alerts, including after a failed attempt', () => {
    expect(decide([sent('2026-10-04T13:00:00+07:00')], NOW, 48)).toMatchObject({ send: false });
    expect(decide([sent('2026-10-04T13:00:00+07:00', 'alert', 0)], NOW, 48)).toMatchObject({ send: false });
    expect(decide([sent('2026-10-04T12:00:00+07:00')], NOW, 48)).toEqual({ send: 'alert', sendNo: 2 });
  });

  it('sends at most 2 a day (Thai calendar day)', () => {
    const rows = [sent('2026-10-04T06:00:00+07:00'), sent('2026-10-04T10:00:00+07:00')];
    expect(decide(rows, NOW, 48)).toEqual({ send: false, reason: 'daily limit reached' });
    expect(decide(rows, Date.parse('2026-10-05T00:30:00+07:00'), 48)).toEqual({ send: 'alert', sendNo: 3 });
  });

  it('stops at the monthly cap after one "limit reached" notice, and starts again next month', () => {
    const rows = Array.from({ length: 48 }, (_, i) => sent(new Date(Date.parse('2026-10-01T00:00:00+07:00') + i * 3600000 * 1.2).toISOString()));
    expect(decide(rows, NOW, 48)).toEqual({ send: 'quota' });
    expect(decide([...rows, sent('2026-10-03T12:00:00+07:00', 'quota')], NOW, 48)).toEqual({ send: false, reason: 'monthly limit reached' });
    expect(decide(rows, Date.parse('2026-11-01T08:00:00+07:00'), 48)).toEqual({ send: 'alert', sendNo: 1 });
  });
});

import { alreadyAnnounced, composeSummary, currentSlot, encodeCoverage, outlookArea } from '../shared/alerts';

describe('twice-daily summary', () => {
  const at = (hhmm: string) => Date.parse(`2026-10-04T${hhmm}:00+07:00`);
  const fcAt = (now: number, tmd: ForecastHour[], om: ForecastHour[]) => ({ ...fc(tmd, om), tmd: { ...fc(tmd, om).tmd, fetched_at: new Date(now - 60000).toISOString() }, openmeteo: { ...fc(tmd, om).openmeteo, fetched_at: new Date(now - 60000).toISOString() } });

  it('opens at 08:00 and 18:00 Thai time for two hours', () => {
    expect(currentSlot(at('07:59'))).toBeNull();
    expect(currentSlot(at('08:00'))).toBe(8);
    expect(currentSlot(at('09:50'))).toBe(8);
    expect(currentSlot(at('10:00'))).toBeNull();
    expect(currentSlot(at('18:05'))).toBe(18);
  });

  it('finds the span of wet hours in the next 12 hours', () => {
    const now = at('08:00');
    const o = outlookArea(area, fcAt(now, [{ time: iso(16), mm: 2, cond: 8 }], [{ time: iso(14), mm: 1, prob: 70 }, { time: iso(15), mm: 1, prob: 85 }, { time: iso(21), mm: 9, prob: 90 }]), now);
    expect(o.kind).toBe('storm');
    expect(o.fromMs).toBe(Date.parse(iso(14)));
    expect(o.toMs).toBe(Date.parse(iso(16))); // 21:00 is past the 12-hour window (08:00 to 20:00)
    expect(o.maxProb).toBe(85);
  });

  it('reports a dry area as low chance and lists every area', () => {
    const now = at('08:00');
    const wet = outlookArea(ALERT_AREAS[0], fcAt(now, [], [{ time: iso(14), mm: 1, prob: 70 }, { time: iso(15), mm: 1, prob: 75 }]), now);
    const dry = outlookArea(ALERT_AREAS[5], fcAt(now, [], [{ time: iso(14), mm: 0, prob: 10 }]), now);
    expect(dry.kind).toBeNull();
    const text = composeSummary([dry, wet], now, 'https://example.test', 1, 48, ['Open-Meteo']);
    const lines = text.split('\n');
    expect(lines[0]).toBe('🌦️ พยากรณ์ฝน 12 ชม. ข้างหน้า · 08:00 น.');
    expect(lines[1]).toBe('• มีนบุรี: โอกาสฝนสูง ช่วง 14:00–16:00 น. (สูงสุด 75%)');
    expect(lines[2]).toBe('• ลับแล อุตรดิตถ์: โอกาสฝนต่ำ');
  });

  it('skips an urgent alert that the last summary already announced', () => {
    const now = at('08:00');
    const wet = outlookArea(ALERT_AREAS[0], fcAt(now, [], [{ time: iso(14), mm: 1, prob: 70 }, { time: iso(15), mm: 1, prob: 75 }]), now);
    const coverage = [encodeCoverage([wet])];
    expect(coverage[0]).toBe(`minburi@${Date.parse(iso(14))}-${Date.parse(iso(15))}`);
    const later = at('13:30');
    const covered = evaluateArea(ALERT_AREAS[0], fcAt(later, [], [{ time: iso(14), mm: 1, prob: 80 }]), later)!;
    const fresh = evaluateArea(ALERT_AREAS[3], fcAt(later, [], [{ time: iso(14), mm: 1, prob: 80 }]), later)!;
    const outside = evaluateArea(ALERT_AREAS[0], fcAt(at('16:10'), [], [{ time: iso(17), mm: 1, prob: 80 }]), at('16:10'))!;
    expect(alreadyAnnounced(covered, coverage)).toBe(true);
    expect(alreadyAnnounced(fresh, coverage)).toBe(false);
    expect(alreadyAnnounced(outside, coverage)).toBe(false);
  });

  it('counts summaries and alerts together against the limits', () => {
    const rows = [
      { sent_at: new Date(at('08:00')).toISOString(), kind: 'summary' as const, ok: 1 },
      { sent_at: new Date(at('13:00')).toISOString(), kind: 'alert' as const, ok: 1 },
    ];
    expect(decide(rows, at('18:00'), 48)).toEqual({ send: false, reason: 'daily limit reached' });
    expect(decide(rows.slice(0, 1), at('18:00'), 48)).toEqual({ send: 'alert', sendNo: 2 });
  });
});

describe('alert areas', () => {
  it('has unique ids usable in coverage records, all inside Thailand, on separate forecast cells', () => {
    const ids = ALERT_AREAS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ALERT_AREAS) {
      expect(a.id).toMatch(/^[a-z]+$/);
      expect(a.lat).toBeGreaterThan(5);
      expect(a.lat).toBeLessThan(21);
      expect(a.lng).toBeGreaterThan(97);
      expect(a.lng).toBeLessThan(106);
    }
    const cells = ALERT_AREAS.map((a) => `${a.lat.toFixed(2)},${a.lng.toFixed(2)}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('places the Rayong points in the right districts of the built-in list', async () => {
    expect(ALERT_AREAS.filter((a) => a.name.includes('ระยอง')).map((a) => a.id)).toEqual(['nikhomphatthana', 'mueangrayong', 'pluakdaeng']);
    const { readFileSync } = await import('node:fs');
    const g = JSON.parse(readFileSync(decodeURIComponent(new URL('../public/gazetteer.json', import.meta.url).pathname), 'utf8')) as {
      p: [string, string][];
      a: [string, string, number][];
      t: [string, number, number, number][];
    };
    const find = (tambon: string, district: string) => {
      const t = g.t.find((x) => x[0] === tambon && g.a[x[1]][0] === district && g.p[g.a[x[1]][2]][0] === 'ระยอง');
      return t ? { lat: t[2], lng: t[3] } : null;
    };
    const area = (id: string) => ALERT_AREAS.find((a) => a.id === id)!;
    expect(find('นิคมพัฒนา', 'นิคมพัฒนา')).toEqual({ lat: area('nikhomphatthana').lat, lng: area('nikhomphatthana').lng });
    expect(find('ท่าประดู่', 'เมืองระยอง')).toEqual({ lat: area('mueangrayong').lat, lng: area('mueangrayong').lng });
    expect(find('ปลวกแดง', 'ปลวกแดง')).toEqual({ lat: area('pluakdaeng').lat, lng: area('pluakdaeng').lng });
  });
});
