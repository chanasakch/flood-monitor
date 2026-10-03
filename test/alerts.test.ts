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
