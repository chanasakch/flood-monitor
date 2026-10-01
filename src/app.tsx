import { useEffect, useReducer } from 'preact/hooks';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { TabBar } from './components/TabBar';
import { onLangChange, t } from './lib/i18n';
import { useRoute } from './lib/router';

export function App() {
  const route = useRoute();
  // Re-render the whole tree when the language changes.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onLangChange(() => rerender(0)), []);

  useEffect(() => {
    document.title = t('app.titleLong');
  });

  return (
    <div class="app">
      <a class="skip-link" href="#main">
        {t('app.skip')}
      </a>
      <Header path={route.path} />
      <main id="main" class="page" tabIndex={-1}>
        <h1>{t('app.titleLong')}</h1>
      </main>
      <Footer />
      <TabBar path={route.path} />
    </div>
  );
}
