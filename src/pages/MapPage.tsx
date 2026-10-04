import { Box, Building2, Check, ChevronRight, ExternalLink, Layers as LayersIcon, MapPin, Radar, Save, X } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { freshness } from '../../shared/levels';
import { LAYER_SOURCE, SOURCES, STALE_MINUTES } from '../../shared/sources';
import type { LayerType, Level, RadarResponse, Reading } from '../../shared/types';
import { ForecastSources } from '../components/ForecastSources';
import { Lazy } from '../components/Lazy';
import { ExtLink, Link } from '../components/Link';
import { MiniForecast } from '../components/MiniForecast';
import { PlaceSearch } from '../components/PlaceSearch';
import { ReadingRow, TYPE_ICON } from '../components/ReadingRow';
import { Skeleton } from '../components/States';
import { Banner, Chip, LevelIcon, SourceLine, sourceName, sourceShortName } from '../components/Status';
import { getForecast, getLayer, getRadar, onLayerRefreshed, type Layer } from '../lib/api';
import { buildForecast, summarize } from '../lib/forecast';
import { formatNumber, formatTime } from '../lib/format';
import { inThailand } from '../lib/geo';
import { useAsync, useNow } from '../lib/hooks';
import { pick, t } from '../lib/i18n';
import type { Layers } from '../lib/placeData';
import { navigate, type Route } from '../lib/router';
import type { LayerKey, MapViewProps } from '../map/MapView';

const loadMap = () => import('../map/MapView');

const KEYS: LayerKey[] = ['radar', 'rain', 'water', 'road', 'highway', 'cctv'];
const DEFAULT_VISIBLE: Record<LayerKey, boolean> = { radar: true, rain: true, water: true, road: true, highway: true, cctv: false };
const STORE = 'fm.layers';

function readVisible(): Record<LayerKey, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<LayerKey, boolean>>;
    const out = { ...DEFAULT_VISIBLE };
    for (const k of KEYS) if (typeof saved[k] === 'boolean') out[k] = saved[k]!;
    return out;
  } catch {
    return { ...DEFAULT_VISIBLE };
  }
}

const LEGEND: Record<LayerType, { level: Level; text: string }[]> = {
  rain: [
    { level: 'normal', text: 'rain.legendNormal' },
    { level: 'watch', text: 'rain.legendWatch' },
    { level: 'danger', text: 'rain.legendDanger' },
  ],
  water: [
    { level: 'normal', text: 'water.legendNormal' },
    { level: 'watch', text: 'water.legendWatch' },
    { level: 'danger', text: 'water.legendDanger' },
  ],
  road: [
    { level: 'normal', text: 'road.legendNormal' },
    { level: 'watch', text: 'road.legendWatch' },
    { level: 'danger', text: 'road.legendDanger' },
  ],
  highway: [
    { level: 'watch', text: 'highway.legendWatch' },
    { level: 'danger', text: 'highway.legendDanger' },
  ],
  cctv: [],
};
const LEGEND_NOTE: Record<LayerType, string> = {
  rain: 'rain.legendNote',
  water: 'water.legendNote',
  road: 'road.legendNote',
  highway: 'highway.legendNote',
  cctv: 'cctv.legend',
};

type Sel = { kind: 'reading'; reading: Reading } | { kind: 'point'; lat: number; lng: number; name?: string } | null;

// ---------- panel pieces ----------

function PointPanel({ lat, lng, name, now, pickMode }: { lat: number; lng: number; name?: string; now: number; pickMode: boolean }) {
  const ok = inThailand(lat, lng);
  const fc = useAsync(() => (ok ? getForecast(lat, lng) : Promise.reject(new Error('outside'))), [lat.toFixed(2), lng.toFixed(2)]);
  const view = fc.data ? buildForecast(fc.data, now, 12) : null;
  const summary = view ? summarize(view) : null;
  const at = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  // A searched place keeps its name on the next page and in the save dialog.
  const nameParam = name ? `name=${encodeURIComponent(name)}` : '';
  return (
    <>
      <h2 class="card-title">
        <MapPin size={20} aria-hidden="true" />
        {name ?? t('place.pointTitle')}
      </h2>
      <p class="muted small num">
        {lat.toFixed(4)}, {lng.toFixed(4)}
      </p>
      {!ok ? (
        <Banner level="unknown" title={t('forecast.outside')} />
      ) : (
        <>
          <h3 class="mini-title">{t('forecast.next12')}</h3>
          {fc.loading && !view && <Skeleton h={78} />}
          {!fc.loading && !view?.mmSource && <Chip level="unknown" label={t('forecast.unavailable')} wrap />}
          {view?.mmSource && fc.data && (
            <>
              {view.stale && <Chip level="unknown" label={t('common.notCurrent')} stale />}
              <MiniForecast view={view} />
              {summary && <p class="summary">{summary}</p>}
              <ForecastSources res={fc.data} view={view} now={now} />
            </>
          )}
          <div class="btn-row panel-actions">
            {pickMode ? (
              <button type="button" class="btn btn-primary btn-block" onClick={() => navigate(`/?at=${at}${nameParam && `&${nameParam}`}`)}>
                <Check size={18} aria-hidden="true" />
                {t('map.pickConfirm')}
              </button>
            ) : (
              <>
                <Link to={`/place/at/${at}${nameParam && `?${nameParam}`}`} class="btn btn-primary">
                  {t('map.pointActions')}
                  <ChevronRight size={18} aria-hidden="true" />
                </Link>
                <button type="button" class="btn btn-secondary" onClick={() => navigate(`/?at=${at}${nameParam && `&${nameParam}`}`)}>
                  <Save size={18} aria-hidden="true" />
                  {t('place.saveThis')}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

function ReadingPanel({ reading, now }: { reading: Reading; now: number }) {
  const at = `${reading.lat.toFixed(5)},${reading.lng.toFixed(5)}`;
  if (reading.type === 'cctv') {
    const dir = pick(reading.extra?.direction_th as string | null, reading.extra?.direction_en as string | null);
    return (
      <>
        <h2 class="card-title">{pick(reading.name_th, reading.name_en)}</h2>
        {dir && <p class="muted small">{dir}</p>}
        <ExtLink href={reading.source_url} class="btn btn-primary btn-block panel-actions">
          {t('cctv.open')}
          <ExternalLink size={18} aria-hidden="true" />
          <span class="sr-only">{t('common.newTab')}</span>
        </ExtLink>
        <p class="muted small">{t('cctv.note')}</p>
        <p class="source-line">
          {t('common.source')}: <ExtLink href={SOURCES['bma-cctv'].url}>{sourceName('bma-cctv')}</ExtLink>
        </p>
      </>
    );
  }
  return (
    <>
      <h2 class="card-title">{pick(reading.name_th, reading.name_en)}</h2>
      <div class="readings">
        <ReadingRow reading={reading} now={now} />
      </div>
      <div class="btn-row panel-actions">
        <Link to={`/place/at/${at}`} class="btn btn-secondary btn-block">
          {t('map.pointActions')}
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      </div>
    </>
  );
}

function LayerPanel({
  visible,
  toggle,
  layers,
  errors,
  loading,
  radar,
  radarStale,
  mode3d,
  setMode3d,
  detail,
  setDetail,
  now,
}: {
  visible: Record<LayerKey, boolean>;
  toggle: (k: LayerKey) => void;
  layers: Layers;
  errors: Partial<Record<LayerKey, boolean>>;
  loading: Partial<Record<LayerKey, boolean>>;
  radar: RadarResponse | null;
  radarStale: boolean;
  mode3d: boolean;
  setMode3d: (v: boolean) => void;
  detail: boolean;
  setDetail: (v: boolean) => void;
  now: number;
}) {
  return (
    <>
      <h2 class="card-title">
        <LayersIcon size={20} aria-hidden="true" />
        {t('map.layers')}
      </h2>
      <ul class="layer-list">
        {KEYS.map((k) => {
          const Icon = k === 'radar' ? Radar : TYPE_ICON[k];
          const layer: Layer | undefined = k === 'radar' ? undefined : layers[k];
          const status = k === 'radar' ? radar?.status : layer?.status;
          const down = (status?.consecutive_failures ?? 0) > 0;
          return (
            <li key={k} class="layer-item">
              <label class="switch-row">
                <span class="reading-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span class="switch-text">
                  <span>{t(`${k}.layer`)}</span>
                  {visible[k] && k !== 'radar' && layer && <span class="muted small num">{t('map.items', { n: formatNumber(layer.items.length, 0) })}</span>}
                </span>
                <input type="checkbox" class="switch" role="switch" checked={visible[k]} onChange={() => toggle(k)} />
              </label>

              {visible[k] && (
                <div class="layer-detail">
                  {loading[k] && <p class="muted small">{t('map.loadingLayer')}</p>}
                  {errors[k] && <Chip level="unknown" label={t('map.layerFailed', { name: t(`${k}.layer`) })} wrap />}
                  {down && <Chip level="unknown" label={`${t('common.sourceDown')} · ${t('common.sourceDownNote')}`} wrap />}

                  {k === 'radar' ? (
                    <>
                      {radar?.observed_at ? (
                        <>
                          {radarStale && <Chip level="unknown" label={t('radar.stale')} stale wrap />}
                          <div class={`radar-scale${radarStale ? ' is-stale' : ''}`} aria-hidden="true">
                            <span>{t('radar.legendLight')}</span>
                            <span class="radar-bar" />
                            <span>{t('radar.legendHeavy')}</span>
                          </div>
                          <p class="muted small">{t('radar.legendNote')}</p>
                          <SourceLine source="tmd-radar" url={radar.source_url} observedAt={radar.observed_at} now={now} />
                        </>
                      ) : (
                        !loading[k] && !errors[k] && <Chip level="unknown" label={t('radar.none')} />
                      )}
                    </>
                  ) : (
                    <>
                      <ul class="legend">
                        {LEGEND[k].map((row) => (
                          <li key={row.text}>
                            <span class={`legend-mark mark-${row.level}`}>
                              <LevelIcon level={row.level} size={14} />
                            </span>
                            {t(row.text)}
                          </li>
                        ))}
                        {k !== 'cctv' && (
                          <li>
                            <span class="legend-mark mark-unknown">
                              <LevelIcon level="unknown" stale size={14} />
                            </span>
                            {t('map.staleLegend')}
                          </li>
                        )}
                      </ul>
                      <p class="muted small">{t(LEGEND_NOTE[k])}</p>
                      <p class="source-line">
                        <span>
                          {t('common.source')}: <ExtLink href={SOURCES[LAYER_SOURCE[k]].url}>{sourceShortName(LAYER_SOURCE[k])}</ExtLink>
                        </span>
                        {layer?.fetched_at && (
                          <span class="num">
                            {t('sources.lastSuccess')}: {formatTime(layer.fetched_at)}
                          </span>
                        )}
                      </p>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <label class="switch-row mode3d">
        <span class="reading-icon" aria-hidden="true">
          <Building2 size={20} />
        </span>
        <span class="switch-text">{t('map.detail')}</span>
        <input type="checkbox" class="switch" role="switch" checked={detail} onChange={() => setDetail(!detail)} />
      </label>
      <label class="switch-row">
        <span class="reading-icon" aria-hidden="true">
          <Box size={20} />
        </span>
        <span class="switch-text">{t('map.mode3d')}</span>
        <input type="checkbox" class="switch" role="switch" checked={mode3d} onChange={() => setMode3d(!mode3d)} />
      </label>
      <p class="muted small">{t('about.mapCredit')}</p>
    </>
  );
}

// ---------- page ----------

export function MapPage({ route }: { route: Route }) {
  const now = useNow();
  const pickMode = route.query.get('pick') === '1';
  const [visible, setVisible] = useState(readVisible);
  const [layers, setLayers] = useState<Layers>({});
  const [errors, setErrors] = useState<Partial<Record<LayerKey, boolean>>>({});
  const [loading, setLoading] = useState<Partial<Record<LayerKey, boolean>>>({});
  const [radar, setRadar] = useState<RadarResponse | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [sheet, setSheet] = useState(false);
  const [mode3d, setMode3d] = useState(false);
  const [slowNotice, setSlowNotice] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  const [detail, setDetailState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fm.mapDetail') !== '0';
    } catch {
      return true;
    }
  });
  const setDetail = (v: boolean) => {
    setDetailState(v);
    try {
      localStorage.setItem('fm.mapDetail', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  // Load a layer only once it is switched on (the rain layer alone is over 4,000 stations).
  useEffect(() => {
    let alive = true;
    for (const k of KEYS) {
      if (!visible[k]) continue;
      setLoading((s) => ({ ...s, [k]: k === 'radar' ? !radar : !layers[k as LayerType] }));
      const job = k === 'radar' ? getRadar().then((r) => alive && setRadar(r)) : getLayer(k).then((l) => alive && setLayers((s) => ({ ...s, [k]: l })));
      job
        .then(() => alive && setErrors((s) => ({ ...s, [k]: false })))
        .catch(() => alive && setErrors((s) => ({ ...s, [k]: true })))
        .finally(() => alive && setLoading((s) => ({ ...s, [k]: false })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, refresh]);

  useEffect(() => onLayerRefreshed(() => setRefresh((n) => n + 1)), []);

  // Refresh every 2 minutes while the page is visible.
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && setRefresh((n) => n + 1), 120_000);
    return () => clearInterval(id);
  }, []);

  const toggle = (k: LayerKey) => {
    setVisible((v) => {
      const next = { ...v, [k]: !v[k] };
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const lat = Number(route.query.get('lat'));
  const lng = Number(route.query.get('lng'));
  const zoom = Number(route.query.get('z')) || 13;
  const initialView = route.query.has('lat') && Number.isFinite(lat) && Number.isFinite(lng) && inThailand(lat, lng) ? { lat, lng, zoom } : null;

  const radarFresh = freshness(radar?.observed_at, STALE_MINUTES.radar, now);
  const pin = sel ? (sel.kind === 'reading' ? { lat: sel.reading.lat, lng: sel.reading.lng } : { lat: sel.lat, lng: sel.lng }) : initialView && !pickMode ? initialView : null;

  const mapProps: MapViewProps = {
    layers,
    radar,
    radarFresh,
    visible,
    now,
    mode3d,
    detail,
    initialView,
    focus,
    pin,
    onSelect: (reading) => {
      setSheet(false);
      setSel(pickMode ? { kind: 'point', lat: reading.lat, lng: reading.lng } : { kind: 'reading', reading });
    },
    onPoint: (pos) => {
      setSheet(false);
      setSel({ kind: 'point', ...pos });
    },
    onSlow: () => {
      setMode3d(false);
      setSlowNotice(true);
    },
  };

  return (
    <div class={`map-page${sel ? ' has-selection' : ''}${sheet ? ' sheet-open' : ''}`}>
      <h1 class="sr-only">{t('map.title')}</h1>
      <div class="map-area">
        <Lazy load={loadMap} props={mapProps} height={420} />
        <div class="map-search">
          <PlaceSearch
            id="map-search"
            hideLabel
            onPick={(r) => {
              setSheet(false);
              setFocus({ lat: r.lat, lng: r.lng, zoom: r.source === 'admin' ? 12 : 16.5 });
              setSel({ kind: 'point', lat: r.lat, lng: r.lng, name: r.name });
            }}
          />
        </div>
        {pickMode && !sel && (
          <div class="map-hint" role="status">
            <MapPin size={18} aria-hidden="true" />
            {t('map.pickHint')}
          </div>
        )}
        {slowNotice && (
          <div class="map-hint" role="status">
            {t('map.mode3dOff')}
            <button type="button" class="btn btn-ghost" onClick={() => setSlowNotice(false)} aria-label={t('common.close')}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        <button type="button" class="btn btn-primary map-fab" onClick={() => setSheet(true)} aria-expanded={sheet}>
          <LayersIcon size={20} aria-hidden="true" />
          {t('map.layers')}
        </button>
      </div>

      <aside class="map-panel" aria-label={t('map.layers')}>
        {sel && (
          <section class="card panel-selection" aria-live="polite">
            <button type="button" class="btn btn-ghost panel-close" onClick={() => setSel(null)} aria-label={t('common.close')}>
              <X size={22} aria-hidden="true" />
            </button>
            {sel.kind === 'reading' ? <ReadingPanel reading={sel.reading} now={now} /> : <PointPanel lat={sel.lat} lng={sel.lng} name={sel.name} now={now} pickMode={pickMode} />}
          </section>
        )}
        <section class="card panel-layers">
          <button type="button" class="btn btn-ghost panel-close" onClick={() => setSheet(false)} aria-label={t('common.close')}>
            <X size={22} aria-hidden="true" />
          </button>
          <LayerPanel
            visible={visible}
            toggle={toggle}
            layers={layers}
            errors={errors}
            loading={loading}
            radar={radar}
            radarStale={radarFresh !== 'fresh'}
            mode3d={mode3d}
            setMode3d={(v) => {
              setSlowNotice(false);
              setMode3d(v);
            }}
            detail={detail}
            setDetail={setDetail}
            now={now}
          />
        </section>
      </aside>
    </div>
  );
}
