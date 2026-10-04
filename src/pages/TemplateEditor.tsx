import { FlaskConical, Lock, RotateCcw, Save } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ALERT_AREAS, type AlertKind, type AreaAlert, type AreaOutlook } from '../../shared/alerts';
import {
  checkTemplate,
  DEFAULT_TEMPLATES,
  LINE_TEXT_LIMIT,
  lockedFooter,
  PLACEHOLDERS,
  renderAlert,
  renderSummary,
  worstCaseLength,
  type MessageTemplate,
  type RenderContext,
  type TemplateKind,
} from '../../shared/templates';
import type { LineUser } from '../../shared/types';
import { DEVICES, LinePreview } from '../components/LinePreview';
import { CardSkeleton, ErrorState } from '../components/States';
import { Banner } from '../components/Status';
import { getTemplates, lineSample, saveTemplate, sendTest } from '../lib/admin';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';

const EMOJI = [
  // weather
  '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '💨', '🌪️', '🌫️', '🌈', '☔', '☂️', '💧', '🌊',
  // alerts
  '⚠️', '🚨', '❗', '‼️', '🔴', '🟠', '🟡', '🟢', '🔵', '✅', '❌', '🔔', '🔕', '📢', '📣',
  // places and travel
  '📍', '🗺️', '🏠', '🏢', '🏫', '🚗', '🛵', '🚇', '🛣️', '🌉',
  // time and misc
  '⏰', '🕒', '📅', '🙏', '💙', '👍', '🔦', '🔋', '📱',
];

type Field = keyof MessageTemplate;

const FIELDS: { key: Field; label: string; kinds: TemplateKind[]; placeholders: readonly string[]; multiline?: boolean }[] = [
  { key: 'title', label: 'tpl.fTitle', kinds: ['alert', 'summary'], placeholders: PLACEHOLDERS.title },
  { key: 'line_storm', label: 'tpl.fStorm', kinds: ['alert', 'summary'], placeholders: PLACEHOLDERS.line },
  { key: 'line_heavy', label: 'tpl.fHeavy', kinds: ['alert', 'summary'], placeholders: PLACEHOLDERS.line },
  { key: 'line_rain', label: 'tpl.fRain', kinds: ['alert', 'summary'], placeholders: PLACEHOLDERS.line },
  { key: 'line_dry', label: 'tpl.fDry', kinds: ['summary'], placeholders: PLACEHOLDERS.line },
  { key: 'note', label: 'tpl.fNote', kinds: ['alert', 'summary'], placeholders: [], multiline: true },
];

const PLACEHOLDER_HELP: Record<string, string> = {
  '{ไอคอน}': 'tpl.phIcon',
  '{เวลา}': 'tpl.phTime',
  '{พื้นที่}': 'tpl.phArea',
  '{ช่วงเวลา}': 'tpl.phWhen',
  '{โอกาส}': 'tpl.phProb',
  '{ปริมาณ}': 'tpl.phMm',
};

/** Example data with every kind of line, used when the live forecast has nothing to show. */
function demoAlerts(now: number): AreaAlert[] {
  const kinds: AlertKind[] = ['storm', 'heavy', 'rain'];
  return ALERT_AREAS.slice(0, 4).map((area, i) => ({ area, kind: kinds[i % 3], atMs: now + (i % 2) * 3600000, prob: 70 + i * 5, mm: i === 1 ? 14 : 4 }));
}
function demoOutlooks(now: number): AreaOutlook[] {
  const kinds: (AlertKind | null)[] = ['storm', 'heavy', 'rain', null];
  const h = Math.floor(now / 3600000) * 3600000;
  return ALERT_AREAS.map((area, i) => {
    const kind = kinds[i % 4];
    return { area, kind, fromMs: kind ? h + (2 + i) * 3600000 : null, toMs: kind ? h + (4 + i) * 3600000 : null, maxProb: kind ? 65 + i * 3 : 30 + i };
  });
}

/** Turn validation codes from the shared checker into plain sentences. */
function explain(err: string): string {
  const [field, ...rest] = err.split(': ');
  const what = rest.join(': ');
  const label = FIELDS.find((f) => f.key === field)?.label;
  const name = label ? t(label) : field;
  if (field.startsWith('length')) return t('tpl.errLength', { n: err.match(/\d+/)?.[0] ?? '', max: LINE_TEXT_LIMIT });
  if (what.startsWith('unknown')) return t('tpl.errUnknown', { field: name, ph: what.replace('unknown ', '') });
  if (what.startsWith('needs')) return t('tpl.errNeeds', { field: name, ph: what.replace('needs ', '') });
  if (what.startsWith('longer')) return t('tpl.errLong', { field: name, n: what.replace(/\D/g, '') });
  if (what === 'empty') return t('tpl.errEmpty', { field: name });
  return `${name}: ${what}`;
}

interface Props {
  users: LineUser[];
  accountName: string;
}

export function TemplateEditor({ users, accountName }: Props) {
  const [kind, setKind] = useState<TemplateKind>('summary');
  const [saved, setSaved] = useState<Record<TemplateKind, MessageTemplate> | null>(null);
  const [draft, setDraft] = useState<Record<TemplateKind, MessageTemplate> | null>(null);
  const [sample, setSample] = useState<{ now: number; siteUrl: string; alerts: AreaAlert[]; outlooks: AreaOutlook[]; sources: string[] } | null>(null);
  const [useLive, setUseLive] = useState(true);
  const [deviceId, setDeviceId] = useState('ip15');
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [testUser, setTestUser] = useState<string>(() => {
    try {
      return localStorage.getItem('fm.adminTestUser') ?? '';
    } catch {
      return '';
    }
  });
  const focused = useRef<{ field: Field; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  const load = async () => {
    setLoadError(false);
    try {
      const [tp, sm] = await Promise.all([getTemplates(), lineSample()]);
      if (!tp.body.templates) throw new Error('no templates');
      setSaved(tp.body.templates);
      setDraft(structuredClone(tp.body.templates));
      setSample(sm.body.now ? sm.body : null);
    } catch {
      setLoadError(true);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const now = sample?.now ?? Date.now();
  const tpl = draft?.[kind];
  const ctx: RenderContext = { now, siteUrl: sample?.siteUrl || location.origin, sources: sample?.sources ?? ['กรมอุตุนิยมวิทยา', 'Open-Meteo'], counter: { sendNo: 3, cap: 48 } };

  // Live data when it has something to show for this message type, otherwise the example.
  const liveEmpty = kind === 'alert' ? !sample?.alerts.length : !sample?.outlooks.some((o) => o.kind);
  const showingDemo = !useLive || liveEmpty;
  const text = useMemo(() => {
    if (!tpl) return '';
    return kind === 'alert'
      ? renderAlert(tpl, showingDemo ? demoAlerts(now) : sample!.alerts, ctx)
      : renderSummary(tpl, showingDemo ? demoOutlooks(now) : sample!.outlooks, ctx);
  }, [tpl, kind, showingDemo, sample, now]);
  const longest = tpl ? worstCaseLength(kind, tpl, ALERT_AREAS, ctx) : 0;
  const check = tpl ? checkTemplate(kind, tpl, longest) : { ok: false, errors: [] };
  const dirty = !!tpl && !!saved && JSON.stringify(tpl) !== JSON.stringify(saved[kind]);

  if (loadError) return <ErrorState onRetry={load} />;
  if (!draft || !tpl || !saved) return <CardSkeleton lines={8} />;

  const setField = (field: Field, value: string) => setDraft({ ...draft, [kind]: { ...tpl, [field]: value } });

  /** Insert text at the cursor of the last field the admin was typing in. */
  const insert = (snippet: string, fallback: Field = 'title') => {
    const f = focused.current;
    const field = f?.field ?? fallback;
    const current = tpl[field];
    const start = f?.el.selectionStart ?? current.length;
    const end = f?.el.selectionEnd ?? current.length;
    setField(field, current.slice(0, start) + snippet + current.slice(end));
    requestAnimationFrame(() => {
      if (!f) return;
      f.el.focus();
      f.el.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  const save = async (reset = false) => {
    if (reset && !confirm(t('tpl.resetConfirm'))) return;
    setBusy(true);
    setNotice(null);
    const r = await saveTemplate(kind, reset ? null : tpl).catch(() => null);
    setBusy(false);
    if (r?.body.ok && r.body.template) {
      setSaved({ ...saved, [kind]: r.body.template });
      setDraft({ ...draft, [kind]: structuredClone(r.body.template) });
      setNotice({ ok: true, text: t(reset ? 'tpl.resetDone' : 'tpl.saved') });
    } else {
      setNotice({ ok: false, text: r?.body.errors?.map(explain).join(' · ') ?? t('admin.failed') });
    }
  };

  const test = async () => {
    if (!testUser || !confirm(t('tpl.testConfirm'))) return;
    setBusy(true);
    setNotice(null);
    const r = await sendTest(text, testUser).catch(() => null);
    setBusy(false);
    setNotice(r?.body.ok ? { ok: true, text: t('tpl.testSent') } : { ok: false, text: `${t('admin.failed')}${r?.body.message ? `: ${r.body.message}` : ''}` });
  };

  const device = DEVICES.find((d) => d.id === deviceId) ?? DEVICES[1];
  const followers = users.filter((u) => u.following);
  const pct = Math.min(100, (longest / LINE_TEXT_LIMIT) * 100);

  return (
    <div class="tpl-layout">
      <div class="tpl-editor stack">
        <section class="card">
          <div class="segmented tpl-kind" role="group" aria-label={t('tpl.kind')}>
            {(['summary', 'alert'] as TemplateKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {t(k === 'summary' ? 'tpl.kindSummary' : 'tpl.kindAlert')}
              </button>
            ))}
          </div>
          <p class="muted small tpl-kind-help">{t(kind === 'summary' ? 'tpl.kindSummaryHelp' : 'tpl.kindAlertHelp')}</p>

          <div class="tpl-icons">
            {(['icon_severe', 'icon_normal'] as Field[]).map((f) => (
              <label key={f} class="field">
                <span class="field-label">{t(f === 'icon_severe' ? 'tpl.fIconSevere' : 'tpl.fIconNormal')}</span>
                <input
                  class="input tpl-icon-input"
                  value={tpl[f]}
                  maxLength={20}
                  onFocus={(e) => (focused.current = { field: f, el: e.currentTarget })}
                  onInput={(e) => setField(f, (e.target as HTMLInputElement).value)}
                />
              </label>
            ))}
          </div>

          {FIELDS.filter((f) => f.kinds.includes(kind)).map((f) => (
            <label key={f.key} class="field">
              <span class="field-label">{t(f.label)}</span>
              {f.multiline ? (
                <textarea
                  class="input textarea tpl-note"
                  rows={3}
                  value={tpl[f.key]}
                  placeholder={t('tpl.notePlaceholder')}
                  onFocus={(e) => (focused.current = { field: f.key, el: e.currentTarget })}
                  onInput={(e) => setField(f.key, (e.target as HTMLTextAreaElement).value)}
                />
              ) : (
                <input
                  class="input"
                  value={tpl[f.key]}
                  onFocus={(e) => (focused.current = { field: f.key, el: e.currentTarget })}
                  onInput={(e) => setField(f.key, (e.target as HTMLInputElement).value)}
                />
              )}
              {f.placeholders.length > 0 && (
                <span class="tpl-chips">
                  {f.placeholders.map((ph) => (
                    <button
                      key={ph}
                      type="button"
                      class="tpl-chip"
                      title={t(PLACEHOLDER_HELP[ph])}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (focused.current?.field !== f.key) focused.current = null;
                        insert(ph, f.key);
                      }}
                    >
                      {ph}
                    </button>
                  ))}
                </span>
              )}
            </label>
          ))}

          <div class="tpl-locked">
            <p class="field-label">
              <Lock size={15} aria-hidden="true" /> {t('tpl.locked')}
            </p>
            <pre>{lockedFooter(ctx).join('\n').trim()}</pre>
            <p class="muted small">{t('tpl.lockedWhy')}</p>
          </div>
        </section>

        <section class="card">
          <h2 class="tpl-sub">{t('tpl.emoji')}</h2>
          <p class="muted small">{t('tpl.emojiHelp')}</p>
          <div class="emoji-grid">
            {EMOJI.map((e) => (
              <button key={e} type="button" class="emoji-btn" aria-label={e} onMouseDown={(ev) => ev.preventDefault()} onClick={() => insert(e)}>
                {e}
              </button>
            ))}
          </div>
          <h2 class="tpl-sub">{t('tpl.placeholders')}</h2>
          <dl class="tpl-ph-list">
            {Object.entries(PLACEHOLDER_HELP).map(([ph, help]) => (
              <div key={ph}>
                <dt>{ph}</dt>
                <dd>{t(help)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section class="card">
          <h2 class="tpl-sub">{t('tpl.length')}</h2>
          <div class="tpl-meter" role="meter" aria-valuemin={0} aria-valuemax={LINE_TEXT_LIMIT} aria-valuenow={longest} aria-label={t('tpl.length')}>
            <span style={{ width: `${pct}%` }} class={longest > LINE_TEXT_LIMIT ? 'over' : pct > 80 ? 'near' : ''} />
          </div>
          <p class="small num">
            {t('tpl.lengthNow', { n: formatNumber(text.length, 0) })} · {t('tpl.lengthMax', { n: formatNumber(longest, 0), max: formatNumber(LINE_TEXT_LIMIT, 0) })}
          </p>
          <p class="muted small">{t('tpl.lengthHelp')}</p>
          {!check.ok && (
            <div class="stack-gap">
              <Banner level="danger" title={t('tpl.fix')}>
                <ul class="bullets small">
                  {check.errors.map((e) => (
                    <li key={e}>{explain(e)}</li>
                  ))}
                </ul>
              </Banner>
            </div>
          )}
          {notice && (
            <div class="stack-gap">
              <Banner level={notice.ok ? 'normal' : 'danger'} title={notice.text} />
            </div>
          )}
          <div class="btn-row">
            <button type="button" class="btn btn-primary" onClick={() => save(false)} disabled={busy || !check.ok || !dirty}>
              <Save size={18} aria-hidden="true" />
              {t('tpl.save')}
            </button>
            <button type="button" class="btn btn-secondary" onClick={() => setDraft({ ...draft, [kind]: structuredClone(saved[kind]) })} disabled={busy || !dirty}>
              {t('tpl.discard')}
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              onClick={() => save(true)}
              disabled={busy || JSON.stringify(saved[kind]) === JSON.stringify(DEFAULT_TEMPLATES[kind])}
            >
              <RotateCcw size={18} aria-hidden="true" />
              {t('tpl.reset')}
            </button>
          </div>
          {dirty && <p class="muted small tpl-unsaved">{t('tpl.unsaved')}</p>}
        </section>

        <section class="card">
          <h2 class="tpl-sub">{t('tpl.test')}</h2>
          <p class="muted small">{t('tpl.testHelp')}</p>
          {followers.length === 0 ? (
            <p class="muted small">{t('admin.noUsers')} · {t('admin.howToRegister')}</p>
          ) : (
            <div class="tpl-test">
              <label class="sr-only" for="tpl-test-user">
                {t('tpl.testTo')}
              </label>
              <select
                id="tpl-test-user"
                class="input"
                value={testUser}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  setTestUser(v);
                  try {
                    localStorage.setItem('fm.adminTestUser', v);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <option value="">{t('tpl.testPick')}</option>
                {followers.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.display_name ?? t('admin.unnamed')}
                  </option>
                ))}
              </select>
              <button type="button" class="btn btn-secondary" onClick={test} disabled={busy || !testUser || !check.ok}>
                <FlaskConical size={18} aria-hidden="true" />
                {t('tpl.testSend')}
              </button>
            </div>
          )}
        </section>
      </div>

      <aside class="tpl-preview card" aria-label={t('tpl.preview')}>
        <div class="tpl-preview-head">
          <h2 class="tpl-sub">{t('tpl.preview')}</h2>
          <label class="sr-only" for="tpl-device">
            {t('tpl.device')}
          </label>
          <select id="tpl-device" class="input tpl-device" value={deviceId} onChange={(e) => setDeviceId((e.target as HTMLSelectElement).value)}>
            {DEVICES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} · {d.width}px
              </option>
            ))}
          </select>
        </div>
        <div class="segmented tpl-data" role="group" aria-label={t('tpl.data')}>
          <button type="button" aria-pressed={useLive} onClick={() => setUseLive(true)}>
            {t('tpl.dataLive')}
          </button>
          <button type="button" aria-pressed={!useLive} onClick={() => setUseLive(false)}>
            {t('tpl.dataDemo')}
          </button>
        </div>
        {useLive && liveEmpty && <p class="muted small">{t('tpl.liveEmpty')}</p>}
        <LinePreview text={text} device={device} accountName={accountName} now={now} />
        <p class="muted small">{t('tpl.previewNote')}</p>
      </aside>
    </div>
  );
}
