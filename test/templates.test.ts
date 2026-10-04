import { describe, expect, it } from 'vitest';
import { ALERT_AREAS, type AreaAlert, type AreaOutlook } from '../shared/alerts';
import { checkTemplate, DEFAULT_TEMPLATES, LINE_TEXT_LIMIT, normalizeTemplate, renderAlert, renderSummary, worstCaseLength } from '../shared/templates';

const NOW = Date.parse('2026-10-04T08:00:00+07:00');
const ctx = { now: NOW, siteUrl: 'https://example.test', sources: ['กรมอุตุนิยมวิทยา'], counter: { sendNo: 2, cap: 48 } };
const alert: AreaAlert = { area: ALERT_AREAS[0], kind: 'rain', atMs: NOW + 3600000, prob: 70, mm: 1 };
const outlook = (kind: AreaOutlook['kind'], i = 0): AreaOutlook => ({
  area: ALERT_AREAS[i],
  kind,
  fromMs: kind ? NOW + 6 * 3600000 : null,
  toMs: kind ? NOW + 8 * 3600000 : null,
  maxProb: kind ? 80 : 40,
});

describe('message templates', () => {
  it('renders a custom template and always keeps the fixed footer', () => {
    const tpl = { ...DEFAULT_TEMPLATES.alert, title: '{ไอคอน}{ไอคอน} ฝนมา! {เวลา}', line_rain: '👉 {พื้นที่} {โอกาส}% {ช่วงเวลา}', note: 'พกร่มด้วยนะ ☂️' };
    const lines = renderAlert(tpl, [alert], ctx).split('\n');
    expect(lines[0]).toBe('🌧️🌧️ ฝนมา! 08:00');
    expect(lines[1]).toBe('👉 มีนบุรี 70% ช่วง 09:00 น.');
    expect(lines).toContain('พกร่มด้วยนะ ☂️');
    expect(lines).toContain('ดูรายละเอียด: https://example.test');
    expect(lines).toContain('แจ้งเตือนครั้งที่ 2/48 ของเดือนนี้');
    expect(lines[lines.length - 1]).toBe('ใช้ประกอบการตัดสินใจเท่านั้น โปรดตรวจสอบประกาศทางการอีกครั้ง');
  });

  it('omits the monthly counter for manual messages and hides dry areas when their line is empty', () => {
    const tpl = { ...DEFAULT_TEMPLATES.summary, line_dry: '' };
    const text = renderSummary(tpl, [outlook('rain', 0), outlook(null, 1)], { ...ctx, counter: null });
    expect(text).not.toContain('แจ้งเตือนครั้งที่');
    expect(text).toContain('• มีนบุรี: โอกาสฝนสูง ช่วง 14:00–17:00 น. (สูงสุด 80%)');
    expect(text).not.toContain(ALERT_AREAS[1].name);
  });

  it('shows an unknown probability as a dash without a percent sign', () => {
    const text = renderAlert(DEFAULT_TEMPLATES.alert, [{ ...alert, prob: null }], ctx);
    expect(text).toContain('• มีนบุรี: โอกาสฝน – ช่วง 09:00 น.');
  });

  it('accepts the defaults and reports bad fields in plain codes', () => {
    for (const kind of ['alert', 'summary'] as const) {
      const len = worstCaseLength(kind, DEFAULT_TEMPLATES[kind], ALERT_AREAS, ctx);
      expect(len).toBeLessThan(LINE_TEXT_LIMIT);
      expect(checkTemplate(kind, DEFAULT_TEMPLATES[kind], len)).toEqual({ ok: true, errors: [] });
    }
    const bad = { ...DEFAULT_TEMPLATES.alert, title: '  ', line_storm: 'พายุ {เมือง}' };
    const r = checkTemplate('alert', bad, 100);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('title: empty');
    expect(r.errors).toContain('line_storm: unknown {เมือง}');
    expect(r.errors).toContain('line_storm: needs {พื้นที่}');
  });

  it('cannot pass the limit with the current areas, because each field is capped', () => {
    const longest = { ...DEFAULT_TEMPLATES.summary, title: 'ก'.repeat(300), line_rain: `{พื้นที่} ${'ฝ'.repeat(290)}`, line_storm: `{พื้นที่} ${'ฝ'.repeat(290)}`, note: 'น'.repeat(1000) };
    expect(worstCaseLength('summary', longest, ALERT_AREAS, ctx)).toBeLessThan(LINE_TEXT_LIMIT);
  });

  it("refuses a template whose longest message would pass LINE's 5,000 limit (e.g. after adding many areas)", () => {
    const huge = { ...DEFAULT_TEMPLATES.summary, line_rain: `{พื้นที่} ${'ฝน'.repeat(140)}` };
    const manyAreas = [...ALERT_AREAS, ...ALERT_AREAS, ...ALERT_AREAS];
    const len = worstCaseLength('summary', huge, manyAreas, ctx);
    expect(len).toBeGreaterThan(LINE_TEXT_LIMIT);
    expect(checkTemplate('summary', huge, len).errors.some((e) => e.startsWith('length'))).toBe(true);
  });

  it('fills missing fields from the default and ignores unknown ones', () => {
    const t = normalizeTemplate('alert', { title: 'X {เวลา}', evil: '<script>' });
    expect(t.title).toBe('X {เวลา}');
    expect(t.line_rain).toBe(DEFAULT_TEMPLATES.alert.line_rain);
    expect(t).not.toHaveProperty('evil');
  });
});
