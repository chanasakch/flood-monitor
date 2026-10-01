import { Camera, CloudRain, Construction, Waves } from 'lucide-preact';
import type { Reading } from '../../shared/types';
import { formatKm, formatNumber } from '../lib/format';
import { pick, t } from '../lib/i18n';
import { shown } from '../lib/status';
import { Chip, SourceLine } from './Status';
import { RoadFloodIcon } from './icons';

export const TYPE_ICON = { rain: CloudRain, water: Waves, road: RoadFloodIcon, highway: Construction, cctv: Camera } as const;

export function unitText(unit: string): string {
  switch (unit) {
    case 'mm':
      return t('unit.mm');
    case 'cm':
      return t('unit.cm');
    case 'm MSL':
      return t('unit.mMsl');
    default:
      return unit;
  }
}

/** Extra facts shown under the main value, per layer. */
export function readingDetails(r: Reading): string[] {
  const x = r.extra ?? {};
  const out: string[] = [];
  if (r.type === 'rain') {
    out.push(`${t('rain.r1')}: ${x.rain_1h == null ? t('common.noData') : `${formatNumber(x.rain_1h as number)} ${t('unit.mm')}`}`);
  }
  if (r.type === 'water') {
    if (typeof x.storage_percent === 'number') out.push(`${t('water.capacity')}: ${formatNumber(x.storage_percent, 0)}%`);
    if (typeof x.bank === 'number') out.push(`${t('water.bank')}: ${formatNumber(x.bank, 2)} ${t('unit.mMsl')}`);
    if (typeof x.river === 'string') out.push(`${t('water.river')}: ${x.river}`);
  }
  if (r.type === 'highway') {
    if (typeof x.road === 'string') out.push(t('highway.road', { n: x.road }));
    if (typeof x.km_start === 'string' && typeof x.km_end === 'string') out.push(t('highway.km', { a: x.km_start, b: x.km_end }));
    if (typeof x.depth_text === 'string') out.push(`${t('highway.depth')}: ${x.depth_text} ${t('unit.cm')}`);
    if (typeof x.reason === 'string') out.push(`${t('highway.reason')}: ${x.reason}`);
    if (typeof x.province_th === 'string') out.push(x.province_th);
  }
  return out;
}

export function readingTitle(r: Reading): string {
  return r.type === 'rain' ? t('rain.r24') : r.type === 'water' ? t('water.level') : r.type === 'road' ? t('road.depth') : t(`${r.type}.title`);
}

interface Props {
  reading: Reading;
  km?: number;
  now: number;
  /** Heading for the row, e.g. "Nearest rain station". Defaults to the layer name. */
  label?: string;
}

/** One data point with everything the accuracy rules require: value, level text, source, link and time. */
export function ReadingRow({ reading: r, km, now, label }: Props) {
  const s = shown(r, now);
  const Icon = TYPE_ICON[r.type];
  const isFresh = s.fresh === 'fresh';
  const hasValue = r.value != null && r.type !== 'highway';
  return (
    <div class="reading">
      <span class="reading-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <div class="reading-label">
        {label ?? readingTitle(r)}
        {km != null && <> · {t('common.distanceAway', { d: formatKm(km) })}</>}
      </div>
      <div>
        <div class="reading-main">
          {hasValue && (
            <span class={`reading-value${isFresh ? '' : ' is-stale'}`}>
              {formatNumber(r.value, r.type === 'water' ? 2 : 1)} <small>{unitText(r.unit)}</small>
            </span>
          )}
          <Chip level={s.level} label={s.label} stale={!isFresh} />
        </div>
        <div class="reading-meta">
          <strong>{pick(r.name_th, r.name_en)}</strong>
          {readingDetails(r).map((d) => (
            <span key={d}> · {d}</span>
          ))}
        </div>
        <SourceLine source={r.source} url={r.source_url} observedAt={r.observed_at} fresh={s.fresh} now={now} />
      </div>
    </div>
  );
}

/** Row shown when no monitoring point exists nearby. Never implies "not flooded". */
export function NoReadingRow({ type, text, note }: { type: Reading['type']; text: string; note?: string }) {
  const Icon = TYPE_ICON[type];
  return (
    <div class="reading">
      <span class="reading-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <div class="reading-label">{t(`${type}.title`)}</div>
      <div>
        <div class="reading-main">
          <Chip level="unknown" label={t('common.noData')} />
        </div>
        <div class="reading-meta">
          {text}
          {note && <> · {note}</>}
        </div>
      </div>
    </div>
  );
}
