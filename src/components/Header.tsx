import { Droplets, Languages, Monitor, Moon, Sun } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { getLang, setLang, t } from '../lib/i18n';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../lib/theme';
import { Link } from './Link';
import { NAV_ITEMS } from './nav';

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };

export function Header({ path }: { path: string }) {
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const lang = getLang();
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const themeName = t(theme === 'light' ? 'header.themeLight' : theme === 'dark' ? 'header.themeDark' : 'header.themeSystem');

  return (
    <header class="app-header">
      <Link to="/" class="brand" aria-label={t('app.titleLong')}>
        <span class="brand-mark" aria-hidden="true">
          <Droplets size={20} />
        </span>
        <span class="brand-text">{t('app.title')}</span>
      </Link>

      <nav class="top-nav" aria-label={t('nav.label')}>
        {NAV_ITEMS.map((item) => (
          <Link key={item.to} to={item.to} class="top-nav-link" aria-current={item.match(path) ? 'page' : undefined}>
            {t(item.label)}
          </Link>
        ))}
      </nav>

      <div class="header-actions">
        <button
          type="button"
          class="btn btn-ghost"
          onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
          aria-label={`${t('header.language')}: ${lang === 'th' ? t('header.switchToEn') : t('header.switchToTh')}`}
          lang={lang === 'th' ? 'en' : 'th'}
        >
          <Languages size={20} aria-hidden="true" />
          <span>{lang === 'th' ? 'EN' : 'ไทย'}</span>
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          onClick={() => {
            const next = NEXT_THEME[theme];
            setThemeChoice(next);
            setTheme(next);
          }}
          aria-label={`${t('header.theme')}: ${themeName}`}
          title={`${t('header.theme')}: ${themeName}`}
        >
          <ThemeIcon size={20} aria-hidden="true" />
          <span class="theme-name">{themeName}</span>
        </button>
      </div>
    </header>
  );
}
