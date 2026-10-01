import { t } from '../lib/i18n';
import { Link } from './Link';
import { NAV_ITEMS } from './nav';

/** Bottom navigation on phones and tablets. Hidden on desktop, where the header carries the links. */
export function TabBar({ path }: { path: string }) {
  return (
    <nav class="tabbar" aria-label={t('nav.label')}>
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.to} to={item.to} class="tab" aria-current={item.match(path) ? 'page' : undefined}>
            <Icon size={22} aria-hidden="true" />
            <span>{t(item.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
