// LINE message templates. The same renderer runs on the server (real sends) and in the admin
// page (preview), so the preview is character-for-character what LINE receives.

import type { AlertKind, AreaAlert, AreaOutlook } from './alerts';

/** LINE text message limit. Counted in UTF-16 units (an emoji counts as 2), which is never below LINE's own count. */
export const LINE_TEXT_LIMIT = 5000;
/** Our own cap per editable field, so one field cannot eat the whole message. */
export const FIELD_LIMIT = 300;
export const NOTE_LIMIT = 1000;

export interface MessageTemplate {
  /** Icon used when any area has a storm or heavy rain. */
  icon_severe: string;
  /** Icon used otherwise. */
  icon_normal: string;
  /** First line. */
  title: string;
  line_storm: string;
  line_heavy: string;
  line_rain: string;
  /** Summary only: an area that does not reach the alert threshold. */
  line_dry: string;
  /** Optional free text placed before the fixed footer. */
  note: string;
}

export type TemplateKind = 'alert' | 'summary';

export const DEFAULT_TEMPLATES: Record<TemplateKind, MessageTemplate> = {
  alert: {
    icon_severe: '⛈️',
    icon_normal: '🌧️',
    title: '{ไอคอน} เตือนฝน · {เวลา} น.',
    line_storm: '• {พื้นที่}: เสี่ยงพายุฝนฟ้าคะนอง {ช่วงเวลา}',
    line_heavy: '• {พื้นที่}: ฝนหนัก{ปริมาณ} {ช่วงเวลา}',
    line_rain: '• {พื้นที่}: โอกาสฝน {โอกาส}% {ช่วงเวลา}',
    line_dry: '',
    note: '',
  },
  summary: {
    icon_severe: '⛈️',
    icon_normal: '🌦️',
    title: '{ไอคอน} พยากรณ์ฝน 12 ชม. ข้างหน้า · {เวลา} น.',
    line_storm: '• {พื้นที่}: เสี่ยงพายุฝนฟ้าคะนอง {ช่วงเวลา} (สูงสุด {โอกาส}%)',
    line_heavy: '• {พื้นที่}: ฝนหนัก {ช่วงเวลา} (สูงสุด {โอกาส}%)',
    line_rain: '• {พื้นที่}: โอกาสฝนสูง {ช่วงเวลา} (สูงสุด {โอกาส}%)',
    line_dry: '• {พื้นที่}: ยังไม่ถึงเกณฑ์เตือน (โอกาสฝนสูงสุด {โอกาส}%)',
    note: '',
  },
};

/** Placeholders each field may use. Anything else in braces is reported as unknown. */
export const PLACEHOLDERS = {
  title: ['{ไอคอน}', '{เวลา}'],
  line: ['{พื้นที่}', '{ช่วงเวลา}', '{โอกาส}', '{ปริมาณ}'],
} as const;

export const TEMPLATE_FIELDS: (keyof MessageTemplate)[] = ['icon_severe', 'icon_normal', 'title', 'line_storm', 'line_heavy', 'line_rain', 'line_dry', 'note'];

// ---------- rendering ----------

const hhmm = (ms: number) => new Date(ms + 7 * 3600000).toISOString().slice(11, 16);

function fill(text: string, values: Record<string, string>): string {
  // An unknown probability shows as "–", not "–%".
  return text.replace(/\{[^{}]+\}/g, (m) => (m in values ? values[m] : m)).replace(/–%/g, '–');
}

export interface RenderContext {
  now: number;
  siteUrl: string;
  sources: string[];
  /** Automatic sends show "alert n of cap this month"; manual sends do not. */
  counter?: { sendNo: number; cap: number } | null;
}

/**
 * The fixed end of every message. It cannot be edited: the project's accuracy rules require the
 * source, a link to details and the disclaimer on everything the site publishes.
 */
export function lockedFooter(ctx: RenderContext): string[] {
  return [
    '',
    `ที่มา: ${ctx.sources.length ? ctx.sources.join(', ') : 'กรมอุตุนิยมวิทยา, Open-Meteo'} (เป็นพยากรณ์ อาจคลาดเคลื่อน)`,
    `ดูรายละเอียด: ${ctx.siteUrl}`,
    ...(ctx.counter ? [`แจ้งเตือนครั้งที่ ${ctx.counter.sendNo}/${ctx.counter.cap} ของเดือนนี้`] : []),
    'ใช้ประกอบการตัดสินใจเท่านั้น โปรดตรวจสอบประกาศทางการอีกครั้ง',
  ];
}

const STRENGTH: Record<AlertKind, number> = { rain: 1, heavy: 2, storm: 3 };

function lineFor(tpl: MessageTemplate, kind: AlertKind | null): string {
  if (kind === 'storm') return tpl.line_storm;
  if (kind === 'heavy') return tpl.line_heavy;
  if (kind === 'rain') return tpl.line_rain;
  return tpl.line_dry;
}

function finish(tpl: MessageTemplate, title: string, lines: string[], ctx: RenderContext): string {
  const note = tpl.note.trim();
  return [title, ...lines.filter((l) => l.trim()), ...(note ? ['', note] : []), ...lockedFooter(ctx)].join('\n');
}

/** Urgent alert: one line per area with rain within two hours, strongest first. */
export function renderAlert(tpl: MessageTemplate, alerts: AreaAlert[], ctx: RenderContext): string {
  const sorted = [...alerts].sort((x, y) => STRENGTH[y.kind] - STRENGTH[x.kind] || x.atMs - y.atMs);
  const icon = sorted.some((a) => a.kind !== 'rain') ? tpl.icon_severe : tpl.icon_normal;
  const title = fill(tpl.title, { '{ไอคอน}': icon, '{เวลา}': hhmm(ctx.now) });
  const lines = sorted.map((a) =>
    fill(lineFor(tpl, a.kind), {
      '{พื้นที่}': a.area.name,
      '{ช่วงเวลา}': a.atMs <= ctx.now ? 'ตอนนี้' : `ช่วง ${hhmm(a.atMs)} น.`,
      '{โอกาส}': a.prob != null ? String(a.prob) : '–',
      '{ปริมาณ}': a.mm != null ? ` ราว ${Math.round(a.mm)} มม./ชม.` : '',
    }),
  );
  return finish(tpl, title, lines, ctx);
}

/** 12-hour outlook: every area, wet ones first. */
export function renderSummary(tpl: MessageTemplate, outlooks: AreaOutlook[], ctx: RenderContext): string {
  const sorted = [...outlooks].sort(
    (x, y) => (y.kind ? STRENGTH[y.kind] : 0) - (x.kind ? STRENGTH[x.kind] : 0) || (x.fromMs ?? Infinity) - (y.fromMs ?? Infinity),
  );
  const icon = sorted.some((o) => o.kind && o.kind !== 'rain') ? tpl.icon_severe : tpl.icon_normal;
  const title = fill(tpl.title, { '{ไอคอน}': icon, '{เวลา}': hhmm(ctx.now) });
  const lines = sorted.map((o) => {
    const span =
      o.fromMs == null || o.toMs == null ? '' : o.fromMs === o.toMs ? `ช่วง ${hhmm(o.fromMs)} น.` : `ช่วง ${hhmm(o.fromMs)}–${hhmm(o.toMs + 3600000)} น.`;
    return fill(lineFor(tpl, o.kind), {
      '{พื้นที่}': o.area.name,
      '{ช่วงเวลา}': span,
      '{โอกาส}': o.maxProb != null ? String(o.maxProb) : '–',
      '{ปริมาณ}': '',
    });
  });
  return finish(tpl, title, lines, ctx);
}

/**
 * Longest message this template can produce for these areas: every area in the longest of its
 * line formats, two-digit numbers, a full time span. Used to enforce LINE's 5,000 limit on save.
 */
export function worstCaseLength(kind: TemplateKind, tpl: MessageTemplate, areas: { id: string; name: string; lat: number; lng: number }[], ctx: RenderContext): number {
  const at = ctx.now + 3600000;
  let max = 0;
  for (const k of ['storm', 'heavy', 'rain'] as AlertKind[]) {
    const text =
      kind === 'alert'
        ? renderAlert(tpl, areas.map((area) => ({ area, kind: k, atMs: at, prob: 100, mm: 99 })), ctx)
        : renderSummary(tpl, areas.map((area) => ({ area, kind: k, fromMs: at, toMs: at + 11 * 3600000, maxProb: 100 })), ctx);
    max = Math.max(max, text.length);
  }
  if (kind === 'summary') {
    max = Math.max(max, renderSummary(tpl, areas.map((area) => ({ area, kind: null, fromMs: null, toMs: null, maxProb: 100 })), ctx).length);
  }
  return max;
}

// ---------- validation ----------

export interface TemplateCheck {
  ok: boolean;
  errors: string[];
}

/** Check a template before saving. `worstCaseLength` is the length with every area in the longest line. */
export function checkTemplate(kind: TemplateKind, tpl: Partial<MessageTemplate>, worstCaseLength: number): TemplateCheck {
  const errors: string[] = [];
  for (const f of TEMPLATE_FIELDS) {
    const v = tpl[f];
    if (typeof v !== 'string') {
      errors.push(`${f}: missing`);
      continue;
    }
    const limit = f === 'note' ? NOTE_LIMIT : f.startsWith('icon') ? 20 : FIELD_LIMIT;
    if (v.length > limit) errors.push(`${f}: longer than ${limit}`);
    if (f === 'title' || f.startsWith('line_')) {
      const allowed: readonly string[] = f === 'title' ? PLACEHOLDERS.title : PLACEHOLDERS.line;
      for (const m of v.match(/\{[^{}]+\}/g) ?? []) if (!allowed.includes(m)) errors.push(`${f}: unknown ${m}`);
    }
  }
  for (const f of ['line_storm', 'line_heavy', 'line_rain'] as const) {
    if (typeof tpl[f] === 'string' && !tpl[f]!.includes('{พื้นที่}')) errors.push(`${f}: needs {พื้นที่}`);
  }
  if (kind === 'summary' && typeof tpl.line_dry === 'string' && tpl.line_dry.trim() && !tpl.line_dry.includes('{พื้นที่}')) {
    errors.push('line_dry: needs {พื้นที่}');
  }
  if (typeof tpl.title === 'string' && !tpl.title.trim()) errors.push('title: empty');
  if (worstCaseLength > LINE_TEXT_LIMIT) errors.push(`length ${worstCaseLength} > ${LINE_TEXT_LIMIT}`);
  return { ok: errors.length === 0, errors };
}

/** Keep only known string fields, falling back to the default for anything missing. */
export function normalizeTemplate(kind: TemplateKind, input: unknown): MessageTemplate {
  const base = DEFAULT_TEMPLATES[kind];
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out = { ...base };
  for (const f of TEMPLATE_FIELDS) if (typeof src[f] === 'string') out[f] = src[f] as string;
  return out;
}
