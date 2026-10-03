import { BellRing, ExternalLink, RefreshCw } from 'lucide-preact';
import { SOURCE_IDS, SOURCES } from '../../shared/sources';
import type { AlertsStatus, Level, SourceStatus } from '../../shared/types';
import { ExtLink } from '../components/Link';
import { CardSkeleton, ErrorState } from '../components/States';
import { Chip, sourceName } from '../components/Status';
import { getSources } from '../lib/api';
import { formatAgo, formatDateTime, formatNumber, formatTime } from '../lib/format';
import { useAsync, useNow } from '../lib/hooks';
import { t } from '../lib/i18n';
import { directStatus, isDirectSource } from '../lib/thaiwater';

function health(s: SourceStatus): { level: Level; label: string } {
  if (s.consecutive_failures > 0) return { level: 'danger', label: t('sources.failing') };
  if (!s.last_success_at) return { level: 'unknown', label: t('sources.never') };
  return { level: 'normal', label: t('sources.ok') };
}

function threshold(min: number | null): string {
  if (min == null) return t('sources.thresholdNone');
  return min >= 120 ? t('sources.thresholdHour', { n: min / 60 }) : t('sources.thresholdMin', { n: min });
}

function AlertsCard({ a, now }: { a: AlertsStatus; now: number }) {
  const state: { level: Level; label: string } = !a.configured
    ? { level: 'unknown', label: t('alerts.notConfigured') }
    : a.account_ok === false
      ? { level: 'danger', label: t('alerts.error') }
      : { level: 'normal', label: t('alerts.ok') };
  const ago = formatAgo(a.last_sent_at, now);
  return (
    <section class="card errors-card" aria-labelledby="alerts-title">
      <div class="card-head">
        <h2 id="alerts-title" class="card-title">
          <BellRing size={20} aria-hidden="true" />
          {t('alerts.title')}
        </h2>
        <Chip level={state.level} label={state.label} />
      </div>
      <p class="muted small">{t('alerts.intro')}</p>
      <dl class="facts">
        {a.account_name && (
          <div>
            <dt>{t('alerts.account')}</dt>
            <dd>{a.account_name}</dd>
          </div>
        )}
        <div>
          <dt>{t('alerts.sent')}</dt>
          <dd class="num">{t('alerts.sentValue', { n: a.sent_this_month, cap: a.cap })}</dd>
        </div>
        <div>
          <dt>{t('alerts.rules')}</dt>
          <dd>{t('alerts.rulesValue', { day: a.max_per_day, gap: a.min_gap_hours })}</dd>
        </div>
        {a.quota != null && a.used != null && (
          <div>
            <dt>{t('alerts.quota')}</dt>
            <dd class="num">{t('alerts.quotaValue', { used: a.used, quota: a.quota })}</dd>
          </div>
        )}
        <div>
          <dt>{t('alerts.last')}</dt>
          <dd class="num">
            {a.last_sent_at ? formatDateTime(a.last_sent_at) : t('alerts.never')}
            {ago && <span class="muted"> ({ago})</span>}
            {a.last_ok === false && <code>{`${t('alerts.lastFailed')}: ${a.last_error ?? ''}`}</code>}
          </dd>
        </div>
        {a.account_ok === false && a.account_error && (
          <div class="fact-error">
            <dt>{t('alerts.error')}</dt>
            <dd>
              <code>{a.account_error}</code>
            </dd>
          </div>
        )}
        <div>
          <dt>{t('alerts.areas')}</dt>
          <dd>{a.areas.join(' · ')}</dd>
        </div>
      </dl>
    </section>
  );
}

export function SourcesPage() {
  const now = useNow();
  const data = useAsync(getSources, [], 60_000);

  return (
    <>
      <div class="page-head">
        <h1>{t('sources.title')}</h1>
        <button type="button" class="btn btn-secondary" onClick={data.reload} disabled={data.loading}>
          <RefreshCw size={18} aria-hidden="true" />
          {t('common.retry')}
        </button>
      </div>
      <p class="page-intro">{t('sources.intro')}</p>

      {data.error && !data.data && (
        <div class="card">
          <ErrorState onRetry={data.reload} />
        </div>
      )}
      {!data.data && !data.error && (
        <div class="grid two">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {data.data && (
        <>
          <p class="muted small checked">{t('sources.checked', { time: formatTime(data.data.now) })}</p>
          <div class="grid two">
            {SOURCE_IDS.map((id) => {
              // ThaiWater is fetched by this browser, so its status is the one recorded here.
              const s = isDirectSource(id) ? directStatus(id) : data.data!.sources.find((x) => x.source === id);
              if (!s) return null;
              const info = SOURCES[id];
              const h = health(s);
              const ago = formatAgo(s.last_success_at, now);
              return (
                <article class="card source-card" key={id} aria-labelledby={`src-${id}`}>
                  <div class="card-head">
                    <h2 id={`src-${id}`}>{sourceName(id)}</h2>
                    <Chip level={h.level} label={h.label} />
                  </div>
                  <dl class="facts">
                    <div>
                      <dt>{t('sources.lastSuccess')}</dt>
                      <dd class="num">
                        {s.last_success_at ? formatDateTime(s.last_success_at) : t('common.noData')}
                        {ago && <span class="muted"> ({ago})</span>}
                      </dd>
                    </div>
                    {s.item_count != null && (
                      <div>
                        <dt>{t('sources.items')}</dt>
                        <dd class="num">{formatNumber(s.item_count, 0)}</dd>
                      </div>
                    )}
                    <div>
                      <dt>{t('sources.threshold')}</dt>
                      <dd>{threshold(info.stale_minutes)}</dd>
                    </div>
                    {isDirectSource(id) && (
                      <div>
                        <dt>&nbsp;</dt>
                        <dd class="muted">{t('sources.direct')}</dd>
                      </div>
                    )}
                    {info.kind === 'forecast' && (
                      <div>
                        <dt>&nbsp;</dt>
                        <dd class="muted">{t('sources.onDemand')}</dd>
                      </div>
                    )}
                    {s.consecutive_failures > 0 && (
                      <div class="fact-error">
                        <dt>{t('sources.lastError')}</dt>
                        <dd>
                          <span class="num">{formatDateTime(s.last_error_at)}</span> · {t('sources.failures', { n: s.consecutive_failures })}
                          <code>{s.last_error}</code>
                        </dd>
                      </div>
                    )}
                  </dl>
                  <p class="source-line">
                    <ExtLink href={info.url}>
                      {t('common.openSource')} <ExternalLink size={13} aria-hidden="true" />
                      <span class="sr-only">{t('common.newTab')}</span>
                    </ExtLink>
                  </p>
                </article>
              );
            })}
          </div>

          {data.data.alerts && <AlertsCard a={data.data.alerts} now={now} />}

          <section class="card errors-card" aria-labelledby="err-title">
            <h2 id="err-title">{t('sources.recentErrors')}</h2>
            {data.data.recent_errors.length === 0 ? (
              <p class="muted">{t('sources.noErrors')}</p>
            ) : (
              <ul class="error-log">
                {data.data.recent_errors.map((e, i) => (
                  <li key={i}>
                    <span class="num muted">{formatDateTime(e.at)}</span>
                    <strong>{sourceName(e.source)}</strong>
                    {e.ok ? <Chip level="normal" label={t('sources.recovered')} /> : <code>{e.message}</code>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
