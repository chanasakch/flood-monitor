import { ExternalLink, Phone } from 'lucide-preact';
import { SOURCE_IDS, SOURCES } from '../../shared/sources';
import type { Level } from '../../shared/types';
import { ExtLink } from '../components/Link';
import { Chip, sourceName } from '../components/Status';
import { t } from '../lib/i18n';

const LEVELS: { level: Level; label: string; text: string; stale?: boolean }[] = [
  { level: 'normal', label: 'level.normal', text: 'about.normalText' },
  { level: 'watch', label: 'level.watch', text: 'about.watchText' },
  { level: 'danger', label: 'level.danger', text: 'about.dangerText' },
  { level: 'unknown', label: 'level.stale', text: 'about.staleText', stale: true },
];

const NUMBERS = [
  { n: '1669', label: 'footer.n1669' },
  { n: '1784', label: 'footer.n1784' },
  { n: '1555', label: 'footer.n1555' },
] as const;

export function AboutPage() {
  return (
    <>
      <div class="page-head">
        <h1>{t('about.title')}</h1>
      </div>
      <div class="stack prose">
        <section class="card">
          <h2>{t('about.whatTitle')}</h2>
          <p>{t('about.whatText')}</p>
        </section>

        <section class="card">
          <h2>{t('about.colorsTitle')}</h2>
          <p>{t('about.colorsText')}</p>
          <ul class="level-list">
            {LEVELS.map((l) => (
              <li key={l.label}>
                <Chip level={l.level} label={t(l.label)} stale={l.stale} />
                <span>{t(l.text)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section class="card">
          <h2>{t('about.staleTitle')}</h2>
          <p>{t('about.staleBody')}</p>
          <p>{t('about.staleWhy')}</p>
        </section>

        <section class="card">
          <h2>{t('about.noDataTitle')}</h2>
          <p>{t('about.noDataBody')}</p>
        </section>

        <section class="card">
          <h2>{t('about.forecastTitle')}</h2>
          <p>{t('about.forecastBody')}</p>
        </section>

        <section class="card">
          <h2>{t('about.sourcesTitle')}</h2>
          <p>{t('about.sourcesBody')}</p>
          <ul class="link-list">
            {SOURCE_IDS.map((id) => (
              <li key={id}>
                <ExtLink href={SOURCES[id].url} class="link-item">
                  <span>{sourceName(id)}</span>
                  <ExternalLink size={16} aria-hidden="true" />
                  <span class="sr-only">{t('common.newTab')}</span>
                </ExtLink>
              </li>
            ))}
          </ul>
          <p class="muted small">{t('about.mapCredit')}</p>
        </section>

        <section class="card">
          <h2>{t('about.limitsTitle')}</h2>
          <ul class="bullets">
            <li>{t('about.limit1')}</li>
            <li>{t('about.limit2')}</li>
            <li>{t('about.limit3')}</li>
            <li>{t('about.limit4')}</li>
          </ul>
        </section>

        <section class="card">
          <h2>{t('about.installTitle')}</h2>
          <p>{t('about.installBody')}</p>
        </section>

        <section class="card">
          <h2>{t('about.emergencyTitle')}</h2>
          <ul class="emergency left">
            {NUMBERS.map(({ n, label }) => (
              <li key={n}>
                <a href={`tel:${n}`} class="tel">
                  <Phone size={16} aria-hidden="true" />
                  <strong>{n}</strong>
                  <span>{t(label)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
