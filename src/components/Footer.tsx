import { Phone } from 'lucide-preact';
import { t } from '../lib/i18n';

const NUMBERS = [
  { n: '1669', label: 'footer.n1669' },
  { n: '1784', label: 'footer.n1784' },
  { n: '1555', label: 'footer.n1555' },
] as const;

/** Required on every page: the disclaimer and emergency numbers. `compact` is the single-strip form used under the map. */
export function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer class={compact ? 'app-footer compact' : 'app-footer'}>
      <p class="disclaimer">{t('footer.disclaimer')}</p>
      <ul class="emergency" aria-label={t('footer.emergency')}>
        {NUMBERS.map(({ n, label }) => (
          <li key={n}>
            <a href={`tel:${n}`} class="tel">
              <Phone size={compact ? 14 : 16} aria-hidden="true" />
              <strong>{n}</strong>
              <span>{t(label)}</span>
            </a>
          </li>
        ))}
      </ul>
    </footer>
  );
}
