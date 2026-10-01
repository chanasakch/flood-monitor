import { ArrowLeft, Camera, ExternalLink, Map as MapIcon, Pencil, Save, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { SOURCES } from '../../shared/sources';
import type { HistoryPoint, Reading } from '../../shared/types';
import { ForecastSources } from '../components/ForecastSources';
import { Lazy, loadForecastChart, loadSeriesChart } from '../components/Lazy';
import { ExtLink, Link } from '../components/Link';
import { KIND_ICON, OverallBanner } from '../components/PlaceCard';
import { NoReadingRow, ReadingRow } from '../components/ReadingRow';
import { CardSkeleton, EmptyState, ErrorState, Skeleton } from '../components/States';
import { Banner, Chip, SourceLine, sourceName } from '../components/Status';
import { getForecast, getHistory, onLayerRefreshed } from '../lib/api';
import { buildForecast, summarize } from '../lib/forecast';
import { formatDateTime, formatKm, formatNumber, formatTime } from '../lib/format';
import { inThailand, RADIUS_KM } from '../lib/geo';
import { useAsync, useNow, useSubscription } from '../lib/hooks';
import { pick, t } from '../lib/i18n';
import { failingSources, layerDown, loadLayers, summarizePlace } from '../lib/placeData';
import { deletePlace, getPlace, onPlacesChange } from '../lib/places';
import { navigate } from '../lib/router';
import { shown } from '../lib/status';

const DETAIL_LAYERS = ['rain', 'water', 'road', 'highway', 'cctv'] as const;

interface Target {
  id: string | null;
  name: string;
  lat: number;
  lng: number;
  kind: 'home' | 'work' | 'school' | 'other';
}

/** `/place/<id>` is a saved place; `/place/at/<lat>,<lng>` is any point tapped on the map. */
function resolveTarget(path: string, name: string | null): Target | 'not-found' | 'outside' {
  const at = /^\/place\/at\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(path);
  if (at) {
    const lat = Number(at[1]);
    const lng = Number(at[2]);
    if (!inThailand(lat, lng)) return 'outside';
    return { id: null, name: name?.trim().slice(0, 60) || t('place.pointTitle'), lat, lng, kind: 'other' };
  }
  const p = getPlace(decodeURIComponent(path.slice('/place/'.length)));
  return p ? { ...p } : 'not-found';
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Forecast ----------

function ForecastCard({ lat, lng, now }: { lat: number; lng: number; now: number }) {
  const [range, setRange] = useState<'24' | '48'>('24');
  const fc = useAsync(() => getForecast(lat, lng), [lat, lng], 10 * 60_000);
  const view = fc.data ? buildForecast(fc.data, now, Number(range)) : null;
  const summary = view ? summarize(view) : null;

  return (
    <section class="card" aria-labelledby="fc-title">
      <div class="card-head">
        <h2 id="fc-title">{t('forecast.title')}</h2>
        <Segmented
          value={range}
          onChange={setRange}
          label={t('forecast.title')}
          options={[
            { value: '24', label: t('forecast.range24') },
            { value: '48', label: t('forecast.range48') },
          ]}
        />
      </div>
      {fc.loading && !view && <Skeleton h={236} />}
      {fc.error && !view && <ErrorState onRetry={fc.reload} message={t('forecast.unavailable')} />}
      {view && !view.mmSource && <Banner level="unknown" title={t('forecast.unavailable')} />}
      {view?.mmSource && fc.data && (
        <>
          {view.stale && (
            <div class="stack-gap">
              <Chip level="unknown" label={t('common.notCurrent')} stale />
            </div>
          )}
          {view.usingFallback && !view.stale && (
            <div class="stack-gap">
              <Banner level="info">{t('forecast.fallback')}</Banner>
            </div>
          )}
          {summary && <p class="summary">{summary}</p>}
          <Lazy load={loadForecastChart} props={{ view, now }} height={236} />
          <ForecastSources res={fc.data} view={view} now={now} />
          <p class="muted small">{t('forecast.disclaimer')}</p>
          <details class="data-table">
            <summary>{t('forecast.tableCaption')}</summary>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('forecast.colTime')}</th>
                    <th scope="col">{t('forecast.colMm')}</th>
                    {view.hasProb && <th scope="col">{t('forecast.colProb')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {view.hours.map((h) => (
                    <tr key={h.ms}>
                      <th scope="row" class="num">
                        {formatTime(h.ms)}
                      </th>
                      <td class="num">{h.mm == null ? t('common.noData') : formatNumber(h.mm, 1)}</td>
                      {view.hasProb && <td class="num">{h.prob == null ? '–' : formatNumber(h.prob, 0)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

// ---------- Water level history ----------

function WaterCard({ reading, now }: { reading: Reading; now: number }) {
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const h = useAsync(() => getHistory(reading.id), [reading.id]);
  const s = shown(reading, now);
  const cutoff = now - (range === '24h' ? 24 : 7 * 24) * 3600000;
  const points = (h.data?.points ?? []).filter((p) => Date.parse(p.time) >= cutoff);
  const bank = h.data?.thresholds?.bank ?? null;
  const stale = s.fresh !== 'fresh' || !!h.data?.stale;

  return (
    <section class="card" aria-labelledby="wl-title">
      <div class="card-head">
        <div>
          <h2 id="wl-title">{t('water.chartTitle')}</h2>
          <p class="muted small">{pick(reading.name_th, reading.name_en)}</p>
        </div>
        <Segmented
          value={range}
          onChange={setRange}
          label={t('water.chartTitle')}
          options={[
            { value: '24h', label: t('water.range24h') },
            { value: '7d', label: t('water.range7d') },
          ]}
        />
      </div>
      {h.loading && !h.data && <Skeleton h={220} />}
      {h.error && !h.data && <ErrorState onRetry={h.reload} />}
      {h.data && (
        <>
          {stale && (
            <div class="stack-gap">
              <Chip level="unknown" label={t('common.notCurrent')} stale />
            </div>
          )}
          {points.some((p) => p.value != null) ? (
            <Lazy
              load={loadSeriesChart}
              props={{
                points,
                kind: 'line' as const,
                unit: t('unit.mMsl'),
                label: `${t('water.chartTitle')}: ${pick(reading.name_th, reading.name_en)}`,
                stale,
                band: bank != null ? { value: bank, label: t('water.bank') } : null,
              }}
              height={220}
            />
          ) : (
            <Banner level="unknown" title={t('common.noData')} />
          )}
          <p class="muted small">{bank != null ? `${t('water.bandAbove')}: ${formatNumber(bank, 2)} ${t('unit.mMsl')}` : t('water.noBank')}</p>
          <SourceLine source={h.data.source} url={h.data.source_url} observedAt={lastTime(h.data.points) ?? reading.observed_at} now={now} />
        </>
      )}
    </section>
  );
}

function lastTime(points: HistoryPoint[]): string | null {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].value != null) return points[i].time;
  return null;
}

// ---------- Rain accumulation ----------

/**
 * Sum of the last three hourly values, only when all three exist and the newest is recent.
 * Otherwise null: a 3 h total is never estimated from partial data.
 */
function rain3h(points: HistoryPoint[], now: number): { value: number; until: string } | null {
  let end = points.length - 1;
  while (end >= 0 && points[end].value == null) end--;
  if (end < 2) return null;
  const last3 = points.slice(end - 2, end + 1);
  if (last3.some((p) => p.value == null)) return null;
  const t0 = Date.parse(last3[0].time);
  const t2 = Date.parse(last3[2].time);
  if (t2 - t0 !== 2 * 3600000 || now - t2 > 2 * 3600000) return null;
  return { value: last3.reduce((sum, p) => sum + (p.value as number), 0), until: last3[2].time };
}

function RainCard({ reading, now }: { reading: Reading; now: number }) {
  const h = useAsync(() => getHistory(reading.id), [reading.id]);
  const s = shown(reading, now);
  const isFresh = s.fresh === 'fresh';
  const r1 = reading.extra?.rain_1h as number | null | undefined;
  const r3 = h.data && !h.data.stale ? rain3h(h.data.points, now) : null;
  const tile = (label: string, value: number | null | undefined, note?: string) => (
    <div class="tile">
      <span class="tile-label">{label}</span>
      <span class={`tile-value num${isFresh ? '' : ' is-stale'}`}>
        {value == null ? t('common.noData') : formatNumber(value, 1)}
        {value != null && <small> {t('unit.mm')}</small>}
      </span>
      {note && <span class="tile-note">{note}</span>}
    </div>
  );

  return (
    <section class="card" aria-labelledby="rain-title">
      <div class="card-head">
        <div>
          <h2 id="rain-title">{t('rain.accTitle')}</h2>
          <p class="muted small">{pick(reading.name_th, reading.name_en)}</p>
        </div>
        <Chip level={s.level} label={s.label} stale={!isFresh} />
      </div>
      <div class="tiles">
        {tile(t('rain.r1'), r1)}
        {tile(t('rain.r3'), r3?.value, r3 ? formatTime(r3.until) : undefined)}
        {tile(t('rain.r24'), reading.value)}
      </div>
      {h.data && !r3 && <p class="muted small">{t('rain.r3Missing')}</p>}
      <SourceLine source={reading.source} url={reading.source_url} observedAt={reading.observed_at} fresh={s.fresh} now={now} />

      <h3 class="sub-title">{t('rain.hourlyTitle')}</h3>
      {h.loading && !h.data && <Skeleton h={220} />}
      {h.error && !h.data && <ErrorState onRetry={h.reload} />}
      {h.data &&
        (h.data.points.some((p) => p.value != null) ? (
          <>
            {h.data.stale && (
              <div class="stack-gap">
                <Chip level="unknown" label={t('common.notCurrent')} stale />
              </div>
            )}
            <Lazy
              load={loadSeriesChart}
              props={{
                points: h.data.points,
                kind: 'bars' as const,
                unit: t('unit.mm'),
                label: `${t('rain.hourlyTitle')}: ${pick(reading.name_th, reading.name_en)}`,
                stale: h.data.stale || !isFresh,
                digits: 1,
              }}
              height={220}
            />
            <SourceLine source={h.data.source} url={h.data.source_url} observedAt={lastTime(h.data.points)} now={now} />
          </>
        ) : (
          <Banner level="unknown" title={t('common.noData')} />
        ))}
    </section>
  );
}

// ---------- Road sensor history (Bangkok) ----------

function RoadCard({ reading, now }: { reading: Reading; now: number }) {
  const h = useAsync(() => getHistory(reading.id), [reading.id]);
  const s = shown(reading, now);
  const points = h.data?.points ?? [];
  return (
    <section class="card" aria-labelledby="road-title">
      <div class="card-head">
        <div>
          <h2 id="road-title">{t('road.chartTitle')}</h2>
          <p class="muted small">{pick(reading.name_th, reading.name_en)}</p>
        </div>
        <Chip level={s.level} label={s.label} stale={s.fresh !== 'fresh'} />
      </div>
      {h.loading && !h.data && <Skeleton h={220} />}
      {h.error && !h.data && <ErrorState onRetry={h.reload} />}
      {h.data &&
        (points.length >= 2 ? (
          <Lazy
            load={loadSeriesChart}
            props={{
              points,
              kind: 'line' as const,
              unit: t('unit.cm'),
              label: `${t('road.chartTitle')}: ${pick(reading.name_th, reading.name_en)}`,
              stale: s.fresh !== 'fresh',
              band: { value: 10, label: t('road.danger') },
              digits: 1,
            }}
            height={220}
          />
        ) : (
          <Banner level="unknown" title={t('common.noData')} />
        ))}
      <p class="muted small">{t('road.historyNote')}</p>
      <SourceLine source={reading.source} url={reading.source_url} observedAt={reading.observed_at} fresh={s.fresh} now={now} />
    </section>
  );
}

// ---------- Page ----------

export function PlaceDetail({ path, name = null }: { path: string; name?: string | null }) {
  useSubscription(onPlacesChange);
  const now = useNow();
  const target = resolveTarget(path, name);
  const data = useAsync(() => loadLayers([...DETAIL_LAYERS]), [], 5 * 60_000);
  useEffect(() => onLayerRefreshed(data.reload), [data.reload]);

  if (target === 'not-found' || target === 'outside') {
    return (
      <div class="card">
        <EmptyState
          icon={<MapIcon size={28} aria-hidden="true" />}
          title={t(target === 'outside' ? 'place.outside' : 'place.notFound')}
          text={target === 'outside' ? undefined : t('place.notFoundHint')}
        >
          <Link to="/" class="btn btn-primary">
            {t('nav.home')}
          </Link>
        </EmptyState>
      </div>
    );
  }

  const { lat, lng } = target;
  const KindIcon = KIND_ICON[target.kind];
  const s = data.data ? summarizePlace(lat, lng, data.data.layers, now) : null;
  const failing = data.data ? failingSources(data.data.layers) : [];
  const down = (type: 'rain' | 'water' | 'road' | 'highway' | 'cctv') => !!data.data && layerDown(data.data.layers, type);
  const mapLink = `/map?lat=${lat}&lng=${lng}&z=13`;

  const remove = () => {
    if (target.id && confirm(t('place.deleteConfirm', { name: target.name }))) {
      deletePlace(target.id);
      navigate('/');
    }
  };

  return (
    <>
      <Link to="/" class="back-link">
        <ArrowLeft size={18} aria-hidden="true" />
        {t('nav.home')}
      </Link>
      <div class="page-head">
        <h1 class="card-title">
          <span class="kind-badge" aria-hidden="true">
            <KindIcon size={22} />
          </span>
          {target.name}
        </h1>
        <div class="btn-row">
          <Link to={mapLink} class="btn btn-secondary">
            <MapIcon size={18} aria-hidden="true" />
            {t('place.viewOnMap')}
          </Link>
          {target.id ? (
            <>
              <button type="button" class="btn btn-secondary" onClick={() => navigate(`/?edit=${target.id}`)}>
                <Pencil size={18} aria-hidden="true" />
                {t('common.edit')}
              </button>
              <button type="button" class="btn btn-danger" onClick={remove}>
                <Trash2 size={18} aria-hidden="true" />
                {t('common.delete')}
              </button>
            </>
          ) : (
            <button type="button" class="btn btn-primary" onClick={() => navigate(`/?at=${lat},${lng}${name ? `&name=${encodeURIComponent(name)}` : ''}`)}>
              <Save size={18} aria-hidden="true" />
              {t('place.saveThis')}
            </button>
          )}
        </div>
      </div>
      <p class="muted small coords num">
        {lat.toFixed(4)}, {lng.toFixed(4)}
      </p>

      <div class="stack">
        {failing.length > 0 && (
          <Banner level="info" title={`${t('common.sourceDown')}: ${failing.map((l) => sourceName(l.status!.source)).join(', ')}`}>
            {t('common.sourceDownNote')}
          </Banner>
        )}
        {s && <OverallBanner level={s.overall} />}

        <ForecastCard lat={lat} lng={lng} now={now} />

        {data.error && !data.data && (
          <div class="card">
            <ErrorState onRetry={data.reload} />
          </div>
        )}
        {!data.data && !data.error && <CardSkeleton lines={5} />}

        {s && (
          <>
            <section class="card" aria-labelledby="near-title">
              <div class="card-head">
                <h2 id="near-title">{t('place.nearbySensors')}</h2>
              </div>
              <div class="readings">
                {s.rain.length ? (
                  s.rain.map((n) => <ReadingRow key={n.reading.id} reading={n.reading} km={n.km} now={now} />)
                ) : (
                  <NoReadingRow type="rain" text={down('rain') ? t('common.sourceDown') : t('rain.none', { km: RADIUS_KM.rain })} />
                )}
                {s.water.length ? (
                  s.water.map((n) => <ReadingRow key={n.reading.id} reading={n.reading} km={n.km} now={now} />)
                ) : (
                  <NoReadingRow type="water" text={down('water') ? t('common.sourceDown') : t('water.none', { km: RADIUS_KM.water })} />
                )}
                {s.roadApplies &&
                  (s.road.length ? (
                    s.road.map((n) => <ReadingRow key={n.reading.id} reading={n.reading} km={n.km} now={now} />)
                  ) : (
                    <NoReadingRow type="road" text={down('road') ? t('common.sourceDown') : t('road.none', { km: RADIUS_KM.road })} note={t('road.onlyBkk')} />
                  ))}
                {s.highway.length ? (
                  s.highway.map((n) => <ReadingRow key={n.reading.id} reading={n.reading} km={n.km} now={now} />)
                ) : (
                  <NoReadingRow type="highway" text={down('highway') ? t('common.sourceDown') : t('highway.none', { km: RADIUS_KM.highway })} note={t('highway.noneNote')} />
                )}
              </div>
            </section>

            <div class="grid two">
              {s.water[0] && <WaterCard reading={s.water[0].reading} now={now} />}
              {s.rain[0] && <RainCard reading={s.rain[0].reading} now={now} />}
              {s.road[0] && <RoadCard reading={s.road[0].reading} now={now} />}
            </div>

            <section class="card" aria-labelledby="cctv-title">
              <div class="card-head">
                <h2 id="cctv-title" class="card-title">
                  <Camera size={20} aria-hidden="true" />
                  {t('cctv.nearby')}
                </h2>
              </div>
              {s.cctv.length ? (
                <>
                  <ul class="link-list">
                    {s.cctv.map((n) => (
                      <li key={n.reading.id}>
                        <ExtLink href={n.reading.source_url} class="link-item">
                          <span>
                            <strong>{pick(n.reading.name_th, n.reading.name_en)}</strong>
                            <span class="muted small">
                              {' '}
                              · {formatKm(n.km)} · {t('cctv.open')}
                            </span>
                          </span>
                          <ExternalLink size={16} aria-hidden="true" />
                          <span class="sr-only">{t('common.newTab')}</span>
                        </ExtLink>
                      </li>
                    ))}
                  </ul>
                  <p class="muted small">{t('cctv.note')}</p>
                  <p class="source-line">
                    {t('common.source')}: <ExtLink href={SOURCES['bma-cctv'].url}>{sourceName('bma-cctv')}</ExtLink>
                    {data.data?.layers.cctv?.fetched_at && (
                      <span>
                        {t('common.observedAt')}: <span class="num">{formatDateTime(data.data.layers.cctv.fetched_at)}</span>
                      </span>
                    )}
                  </p>
                </>
              ) : (
                <p class="muted">{down('cctv') ? t('cctv.unavailable') : t('cctv.none', { km: RADIUS_KM.cctv })}</p>
              )}
              <p class="small cctv-doh">
                <ExtLink href={SOURCES['bma-cctv'].url}>
                  {t('cctv.bmaLink')} <ExternalLink size={13} aria-hidden="true" />
                  <span class="sr-only">{t('common.newTab')}</span>
                </ExtLink>
              </p>
              <p class="small cctv-doh">
                <ExtLink href="https://highwaytraffic.go.th/DOHWeb/Home.aspx">
                  {t('cctv.dohLink')} <ExternalLink size={13} aria-hidden="true" />
                  <span class="sr-only">{t('common.newTab')}</span>
                </ExtLink>
              </p>
            </section>
          </>
        )}
      </div>
    </>
  );
}
