import { Briefcase, ChevronRight, GraduationCap, House, MapPin } from 'lucide-preact';
import { getForecast } from '../lib/api';
import { buildForecast, summarize } from '../lib/forecast';
import { RADIUS_KM } from '../lib/geo';
import { useAsync } from '../lib/hooks';
import { t } from '../lib/i18n';
import { summarizePlace, type Layers } from '../lib/placeData';
import type { Place, PlaceKind } from '../lib/places';
import { ForecastSources } from './ForecastSources';
import { Link } from './Link';
import { MiniForecast } from './MiniForecast';
import { NoReadingRow, ReadingRow } from './ReadingRow';
import { Skeleton } from './States';
import { Banner, Chip } from './Status';

export const KIND_ICON: Record<PlaceKind, typeof House> = { home: House, work: Briefcase, school: GraduationCap, other: MapPin };

export function OverallBanner({ level }: { level: ReturnType<typeof summarizePlace>['overall'] }) {
  return (
    <Banner level={level} title={t(`overall.${level}`)}>
      {level === 'normal' && <span class="small">{t('overall.normalNote')}</span>}
    </Banner>
  );
}

export function PlaceCard({ place, layers, now }: { place: Place; layers: Layers; now: number }) {
  const s = summarizePlace(place.lat, place.lng, layers, now);
  const fc = useAsync(() => getForecast(place.lat, place.lng), [place.lat, place.lng], 10 * 60_000);
  const view = fc.data ? buildForecast(fc.data, now, 12) : null;
  const summary = view ? summarize(view) : null;
  const Icon = KIND_ICON[place.kind];
  const to = `/place/${place.id}`;

  return (
    <article class="card place-card" aria-labelledby={`pl-${place.id}`}>
      <div class="card-head">
        <h2 class="card-title" id={`pl-${place.id}`}>
          <span class="kind-badge" aria-hidden="true">
            <Icon size={20} />
          </span>
          <span>
            {place.name}
            <span class="kind-text">{t(`place.kind${place.kind[0].toUpperCase()}${place.kind.slice(1)}`)}</span>
          </span>
        </h2>
      </div>

      <OverallBanner level={s.overall} />

      <div class="readings">
        {s.rain[0] ? (
          <ReadingRow reading={s.rain[0].reading} km={s.rain[0].km} now={now} label={t('rain.nearest')} />
        ) : (
          <NoReadingRow type="rain" text={t('rain.none', { km: RADIUS_KM.rain })} />
        )}
        {s.water[0] ? (
          <ReadingRow reading={s.water[0].reading} km={s.water[0].km} now={now} label={t('water.nearest')} />
        ) : (
          <NoReadingRow type="water" text={t('water.none', { km: RADIUS_KM.water })} />
        )}
        {s.roadApplies &&
          (s.road[0] ? (
            <ReadingRow reading={s.road[0].reading} km={s.road[0].km} now={now} label={t('road.nearest')} />
          ) : (
            <NoReadingRow type="road" text={t('road.none', { km: RADIUS_KM.road })} />
          ))}
        {s.highway[0] && <ReadingRow reading={s.highway[0].reading} km={s.highway[0].km} now={now} label={t('highway.nearby')} />}
      </div>

      <section class="mini-block" aria-label={t('forecast.next12')}>
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
      </section>

      <Link to={to} class="btn btn-secondary btn-block">
        {t('common.details')}
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </article>
  );
}
