import { ExternalLink } from 'lucide-preact';
import { SOURCES } from '../../shared/sources';
import type { ForecastResponse } from '../../shared/types';
import type { ForecastView } from '../lib/forecast';
import { formatAgo, formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { ExtLink } from './Link';

/** Says which source each forecast series comes from, with links and fetch time. */
export function ForecastSources({ res, view, now }: { res: ForecastResponse; view: ForecastView; now: number }) {
  if (!view.mmSource) return null;
  const mmName = view.mmSource === 'tmd-nwp' ? t('forecast.tmdShort') : t('forecast.omShort');
  const ago = formatAgo(view.fetchedAt, now);
  const link = (id: 'tmd-nwp' | 'open-meteo', name: string) => (
    <ExtLink href={SOURCES[id].url}>
      {name}
      <ExternalLink size={13} aria-hidden="true" />
      <span class="sr-only">{t('common.newTab')}</span>
    </ExtLink>
  );
  return (
    <p class="source-line">
      <span>
        <span class="legend-swatch swatch-bar" aria-hidden="true" />
        {t('forecast.bars')}: {link(view.mmSource, mmName)}
      </span>
      {view.hasProb && (
        <span>
          <span class="legend-swatch swatch-line" aria-hidden="true" />
          {t('forecast.line')}: {link('open-meteo', t('forecast.omShort'))}
        </span>
      )}
      <span>
        {t('common.observedAt')}: <span class="num">{formatDateTime(view.fetchedAt)}</span>
        {ago && <> ({t('common.updatedAgo', { ago })})</>}
      </span>
      {!view.hasProb && res.openmeteo.ok === false && <span>{t('forecast.noProb')}</span>}
    </p>
  );
}
