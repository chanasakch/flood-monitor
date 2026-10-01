import { CircleAlert, CircleCheck, CircleHelp, Clock, ExternalLink, OctagonAlert, TriangleAlert } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import type { Freshness } from '../../shared/levels';
import { SOURCES } from '../../shared/sources';
import type { Level, SourceId } from '../../shared/types';
import { formatAgo, formatDateTime } from '../lib/format';
import { pick, t } from '../lib/i18n';
import { ExtLink } from './Link';

const ICONS = { normal: CircleCheck, watch: TriangleAlert, danger: OctagonAlert, unknown: CircleHelp } as const;

export function LevelIcon({ level, stale = false, size = 16 }: { level: Level; stale?: boolean; size?: number }) {
  const Icon = stale ? Clock : ICONS[level];
  return <Icon size={size} aria-hidden="true" />;
}

/** Status pill: colour, icon and text together. */
export function Chip({ level, label, stale = false, wrap = false }: { level: Level; label: string; stale?: boolean; wrap?: boolean }) {
  return (
    <span class={`chip chip-${level}${wrap ? ' wrap' : ''}`}>
      <LevelIcon level={level} stale={stale} />
      {label}
    </span>
  );
}

export function Banner({ level, title, children }: { level: Level | 'info'; title?: string; children?: ComponentChildren }) {
  const Icon = level === 'info' ? CircleAlert : ICONS[level];
  return (
    <div class={`banner banner-${level}`} role="status">
      <Icon size={20} aria-hidden="true" />
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function sourceName(id: SourceId): string {
  const s = SOURCES[id];
  return pick(s.name_th, s.name_en);
}

export function sourceShortName(id: SourceId): string {
  const s = SOURCES[id];
  return pick(s.short_th, s.short_en);
}

interface SourceLineProps {
  source: SourceId;
  url: string;
  observedAt: string | null;
  fresh?: Freshness;
  now: number;
}

/** Required next to every data point: source name, link to the original, observation time. */
export function SourceLine({ source, url, observedAt, fresh, now }: SourceLineProps) {
  const ago = formatAgo(observedAt, now);
  return (
    <p class="source-line">
      <span>
        {t('common.source')}:{' '}
        <ExtLink href={url}>
          {sourceShortName(source)}
          <ExternalLink size={13} aria-hidden="true" />
          <span class="sr-only">{t('common.newTab')}</span>
        </ExtLink>
      </span>
      <span>
        {t('common.observedAt')}: <span class="num">{formatDateTime(observedAt)}</span>
        {ago && fresh !== 'future' && <> ({t('common.updatedAgo', { ago })})</>}
        {fresh === 'future' && <> ({t('common.badTime')})</>}
      </span>
    </p>
  );
}
