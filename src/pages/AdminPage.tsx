import { CloudSun, LogIn, LogOut, RefreshCw, Send } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { AdminLineState } from '../../shared/types';
import { CardSkeleton, ErrorState } from '../components/States';
import { Banner, Chip } from '../components/Status';
import { adminLogin, adminLogout, adminMe, composeFromForecast, lineState, sendLine } from '../lib/admin';
import { formatAgo, formatDateTime, formatNumber } from '../lib/format';
import { useNow } from '../lib/hooks';
import { TemplateEditor } from './TemplateEditor';
import { t } from '../lib/i18n';

// ---------- sign in ----------

function LoginForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await adminLogin(username, password);
      if (r.body.ok) return onDone();
      setError(t(r.body.error === 'locked' ? 'admin.locked' : r.body.error === 'not_configured' ? 'admin.notConfigured' : 'admin.wrong'));
    } catch {
      setError(t('common.loadError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="card admin-login" onSubmit={submit}>
      <h2>{t('admin.loginTitle')}</h2>
      <p class="muted small">{t('admin.loginHint')}</p>
      <label class="field">
        <span class="field-label">{t('admin.username')}</span>
        <input class="input" type="text" autocomplete="username" autocapitalize="off" value={username} onInput={(e) => setUsername((e.target as HTMLInputElement).value)} required />
      </label>
      <label class="field">
        <span class="field-label">{t('admin.password')}</span>
        <input class="input" type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} required />
      </label>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" class="btn btn-primary btn-block" disabled={busy}>
        <LogIn size={18} aria-hidden="true" />
        {t('admin.login')}
      </button>
    </form>
  );
}

// ---------- send ----------

function SendPanel({ onLogout }: { onLogout: () => void }) {
  const now = useNow();
  const [tab, setTab] = useState<'send' | 'templates'>('send');
  const [state, setState] = useState<AdminLineState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'all' | 'some'>('all');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoadError(false);
    try {
      const r = await lineState();
      if (r.status === 401) return onLogout();
      setState(r.body);
    } catch {
      setLoadError(true);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  if (loadError) return <ErrorState onRetry={load} />;
  if (!state) return <CardSkeleton lines={6} />;

  const followers = state.users.filter((u) => u.following);
  const recipients = mode === 'all' ? Math.max(followers.length, 6) : chosen.size;
  const remaining = state.account?.quota != null && state.account.used != null ? state.account.quota - state.account.used : null;
  const canSend = !!text.trim() && recipients > 0 && !busy && state.configured && (remaining == null || remaining >= recipients);

  const compose = async () => {
    setComposing(true);
    const r = await composeFromForecast().catch(() => null);
    if (r?.body.text) setText(r.body.text);
    setComposing(false);
  };

  const submit = async () => {
    if (!canSend) return;
    if (!confirm(t('admin.confirm', { n: recipients }))) return;
    setBusy(true);
    setResult(null);
    const r = await sendLine(text.trim(), mode === 'all' ? 'all' : [...chosen]).catch(() => null);
    setBusy(false);
    if (r?.body.ok) {
      setResult({ ok: true, text: t('admin.sent', { n: r.body.recipients ?? recipients }) });
      setText('');
      void load();
    } else {
      const err = r?.body.error;
      setResult({
        ok: false,
        text: err === 'quota' ? t('admin.quotaLeft', { n: r?.body.remaining ?? 0 }) : `${t('admin.failed')}${r?.body.message ? `: ${r.body.message}` : ''}`,
      });
      if (r?.status === 401) onLogout();
    }
  };

  const webhookOk = state.webhook?.active && state.webhook.endpoint?.endsWith('/api/line/webhook');

  const tabs = (
    <div class="segmented admin-tabs" role="group" aria-label={t('admin.title')}>
      <button type="button" aria-pressed={tab === 'send'} onClick={() => setTab('send')}>
        {t('tpl.tabSend')}
      </button>
      <button type="button" aria-pressed={tab === 'templates'} onClick={() => setTab('templates')}>
        {t('tpl.tabTemplates')}
      </button>
    </div>
  );

  if (tab === 'templates') {
    return (
      <div class="stack">
        {tabs}
        <TemplateEditor users={state.users} accountName={state.account?.name ?? 'LINE'} />
      </div>
    );
  }

  return (
    <div class="stack">
      {tabs}
      <section class="card">
        <div class="card-head">
          <h2>{t('admin.accountTitle')}</h2>
          <button type="button" class="btn btn-ghost" onClick={load} aria-label={t('common.retry')}>
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>
        {!state.configured ? (
          <Banner level="unknown" title={t('alerts.notConfigured')} />
        ) : (
          <dl class="facts">
            <div>
              <dt>{t('alerts.account')}</dt>
              <dd>{state.account?.name ?? t('common.noData')}</dd>
            </div>
            {state.account?.quota != null && state.account.used != null && (
              <div>
                <dt>{t('alerts.quota')}</dt>
                <dd class="num">
                  {t('alerts.quotaValue', { used: state.account.used, quota: state.account.quota })} · {t('admin.remaining', { n: remaining ?? 0 })}
                </dd>
              </div>
            )}
            <div>
              <dt>{t('admin.followers')}</dt>
              <dd class="num">{t('admin.followersValue', { n: followers.length })}</dd>
            </div>
          </dl>
        )}
        {state.configured && !webhookOk && (
          <div class="stack-gap admin-note">
            <Banner level="watch" title={t('admin.webhookOff')}>
              <span class="small">{t('admin.webhookHint')}</span>
            </Banner>
          </div>
        )}
      </section>

      <section class="card" aria-labelledby="msg-title">
        <div class="card-head">
          <h2 id="msg-title">{t('admin.messageTitle')}</h2>
        </div>
        <button type="button" class="btn btn-secondary" onClick={compose} disabled={composing}>
          <CloudSun size={18} aria-hidden="true" />
          {composing ? t('common.loading') : t('admin.fromForecast')}
        </button>
        <label class="field admin-text">
          <span class="field-label">{t('admin.message')}</span>
          <textarea class="input textarea" rows={9} maxLength={2000} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder={t('admin.messagePlaceholder')} />
          <span class="muted small num">{t('admin.chars', { n: text.length })}</span>
        </label>

        <fieldset class="field">
          <legend class="field-label">{t('admin.to')}</legend>
          <label class="radio-row">
            <input type="radio" name="to" checked={mode === 'all'} onChange={() => setMode('all')} />
            <span>{t('admin.toAll')}</span>
          </label>
          <label class="radio-row">
            <input type="radio" name="to" checked={mode === 'some'} onChange={() => setMode('some')} />
            <span>{t('admin.toSome')}</span>
          </label>
          {mode === 'some' && (
            <div class="user-list">
              {followers.length === 0 ? (
                <p class="muted small">{t('admin.noUsers')}</p>
              ) : (
                followers.map((u) => (
                  <label key={u.user_id} class="check-row">
                    <input
                      type="checkbox"
                      checked={chosen.has(u.user_id)}
                      onChange={() => {
                        const next = new Set(chosen);
                        if (next.has(u.user_id)) next.delete(u.user_id);
                        else next.add(u.user_id);
                        setChosen(next);
                      }}
                    />
                    <span>
                      <strong>{u.display_name ?? t('admin.unnamed')}</strong>
                      <span class="muted small"> · {t('admin.lastSeen', { ago: formatAgo(u.last_seen, now) ?? '' })}</span>
                    </span>
                  </label>
                ))
              )}
              <p class="muted small">{t('admin.howToRegister')}</p>
            </div>
          )}
        </fieldset>

        <p class="admin-cost num">
          {t('admin.cost', { n: recipients })}
          {remaining != null && <span class="muted"> · {t('admin.remaining', { n: remaining })}</span>}
        </p>
        {result && (
          <div class="stack-gap">
            <Banner level={result.ok ? 'normal' : 'danger'} title={result.text} />
          </div>
        )}
        <button type="button" class="btn btn-primary btn-block" onClick={submit} disabled={!canSend}>
          <Send size={18} aria-hidden="true" />
          {busy ? t('admin.sending') : t('admin.send')}
        </button>
      </section>

      <section class="card" aria-labelledby="hist-title">
        <h2 id="hist-title">{t('admin.history')}</h2>
        {state.recent.length === 0 ? (
          <p class="muted">{t('alerts.never')}</p>
        ) : (
          <ul class="error-log">
            {state.recent.map((r, i) => (
              <li key={i}>
                <span class="num muted">
                  {formatDateTime(r.sent_at)} · {t(`admin.kind_${r.kind}`)}
                  {r.recipients != null && <> · {t('admin.recipientsN', { n: formatNumber(r.recipients, 0) })}</>}
                </span>
                <Chip level={r.ok ? 'normal' : 'danger'} label={r.ok ? t('admin.okShort') : t('admin.failed')} />
                <span class="small">{r.message.split('\n')[0]}</span>
                {r.error && <code>{r.error}</code>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        class="btn btn-secondary"
        onClick={async () => {
          await adminLogout().catch(() => null);
          onLogout();
        }}
      >
        <LogOut size={18} aria-hidden="true" />
        {t('admin.logout')}
      </button>
    </div>
  );
}

export function AdminPage() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const check = () =>
    adminMe()
      .then((r) => setAdmin(r.body.admin))
      .catch(() => setAdmin(false));
  useEffect(() => {
    void check();
  }, []);
  return (
    <>
      <div class="page-head">
        <h1>{t('admin.title')}</h1>
      </div>
      {admin === null ? <CardSkeleton lines={3} /> : admin ? <SendPanel onLogout={() => setAdmin(false)} /> : <LoginForm onDone={() => setAdmin(true)} />}
    </>
  );
}
