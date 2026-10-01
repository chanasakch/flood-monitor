import { WifiOff } from 'lucide-preact';
import { useEffect, useReducer } from 'preact/hooks';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { TabBar } from './components/TabBar';
import { isServedFromCache, onServedFromCacheChange } from './lib/api';
import { useSubscription } from './lib/hooks';
import { onLangChange, t } from './lib/i18n';
import { useRoute } from './lib/router';
import { AboutPage } from './pages/AboutPage';
import { Home } from './pages/Home';
import { MapPage } from './pages/MapPage';
import { PlaceDetail } from './pages/PlaceDetail';
import { SourcesPage } from './pages/SourcesPage';

const TITLES: [RegExp, string][] = [
  [/^\/map/, 'map.title'],
  [/^\/sources/, 'sources.title'],
  [/^\/about/, 'about.title'],
  [/^\//, 'home.title'],
];

export function App() {
  const route = useRoute();
  // Re-render the whole tree when the language changes.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onLangChange(() => rerender(0)), []);
  useSubscription(onServedFromCacheChange);

  const { path } = route;
  const isMap = path.startsWith('/map');

  useEffect(() => {
    const key = TITLES.find(([re]) => re.test(path))![1];
    document.title = `${t(key)} · ${t('app.titleLong')}`;
  });

  // Move focus to the new page for keyboard and screen reader users.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  return (
    <div class={isMap ? 'app is-map' : 'app'}>
      <a class="skip-link" href="#main">
        {t('app.skip')}
      </a>
      <Header path={path} />
      {isServedFromCache() && (
        <div class="offline-bar" role="status">
          <WifiOff size={16} aria-hidden="true" />
          {t('common.offline')}
        </div>
      )}
      <main id="main" class={isMap ? 'page-map' : 'page'} tabIndex={-1}>
        {isMap ? (
          <MapPage route={route} />
        ) : path.startsWith('/place/') ? (
          <PlaceDetail key={path} path={path} name={route.query.get('name')} />
        ) : path === '/sources' ? (
          <SourcesPage />
        ) : path === '/about' ? (
          <AboutPage />
        ) : (
          <Home route={route} />
        )}
      </main>
      <Footer compact={isMap} />
      <TabBar path={path} />
    </div>
  );
}
