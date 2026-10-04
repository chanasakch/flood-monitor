import { Landmark, Link2, MapPin, Search, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { SearchResult } from '../../shared/types';
import { t } from '../lib/i18n';
import { loadGazetteer, looksPasted, resolvePasted, searchAdmin, searchPlaces } from '../lib/search';

interface Props {
  /** Unique id for the input, so its label can point at it. */
  id: string;
  onPick: (result: SearchResult) => void;
  /** Show the label visibly (cards, dialog) or only to screen readers (on the map). */
  hideLabel?: boolean;
}

/**
 * Search box for places. Subdistricts, districts and provinces come from a list bundled with the
 * site (instant, works offline); schools, temples, markets and other named places come from
 * OpenStreetMap through our API after a short pause in typing.
 */
export function PlaceSearch({ id, onPick, hideLabel = false }: Props) {
  const [q, setQ] = useState('');
  const [admin, setAdmin] = useState<SearchResult[]>([]);
  const [places, setPlaces] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [placesDown, setPlacesDown] = useState(false);
  const [provider, setProvider] = useState<'longdo' | 'osm' | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const query = q.trim();

  const pasted = looksPasted(query);
  const [pastedResult, setPastedResult] = useState<SearchResult | null>(null);
  const [pastedFailed, setPastedFailed] = useState(false);

  // A pasted link or coordinates: go straight to that position instead of searching by name.
  useEffect(() => {
    let alive = true;
    setPastedResult(null);
    setPastedFailed(false);
    if (!pasted) return;
    setBusy(true);
    resolvePasted(query).then((p) => {
      if (!alive) return;
      setBusy(false);
      if (!p) return setPastedFailed(true);
      setPastedResult({
        name: p.name ?? t('search.pastedPoint'),
        detail: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
        lat: Math.round(p.lat * 1e5) / 1e5,
        lng: Math.round(p.lng * 1e5) / 1e5,
        source: 'pasted',
      });
    });
    return () => {
      alive = false;
    };
  }, [query, pasted]);

  // Built-in list: search on every keystroke.
  useEffect(() => {
    let alive = true;
    if (query.length < 2 || pasted) {
      setAdmin([]);
      return;
    }
    loadGazetteer().then(
      (list) => alive && setAdmin(searchAdmin(list, query, 5)),
      () => alive && setAdmin([]),
    );
    return () => {
      alive = false;
    };
  }, [query]);

  // Named places: wait until typing pauses, so each word is not sent letter by letter.
  useEffect(() => {
    let alive = true;
    setPlaces([]);
    setPlacesDown(false);
    if (pasted) return;
    if (query.length < 3) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      searchPlaces(query).then((res) => {
        if (!alive) return;
        setPlaces(res.results.slice(0, 8));
        setProvider(res.provider);
        setPlacesDown(!!res.error);
        setBusy(false);
      });
    }, 550);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, pasted]);

  const pick = (r: SearchResult) => {
    setQ('');
    onPick(r);
  };

  const total = admin.length + places.length + (pastedResult ? 1 : 0);
  const showPanel = query.length >= 2;
  const row = (r: SearchResult, i: number) => (
    <li key={`${r.source}-${i}-${r.lat}-${r.lng}`}>
      <button type="button" class="search-result" onClick={() => pick(r)}>
        <span class="reading-icon" aria-hidden="true">
          {r.source === 'admin' ? <MapPin size={18} /> : r.source === 'pasted' ? <Link2 size={18} /> : <Landmark size={18} />}
        </span>
        <span class="search-text">
          <strong>{r.name}</strong>
          {r.detail && <span class="muted small">{r.detail}</span>}
        </span>
      </button>
    </li>
  );

  return (
    <div class="search">
      <label for={id} class={hideLabel ? 'sr-only' : 'field-label'}>
        {t('search.label')}
      </label>
      <div class="search-box">
        <Search size={20} aria-hidden="true" class="search-icon" />
        <input
          ref={input}
          id={id}
          type="search"
          class="input search-input"
          value={q}
          placeholder={t('search.placeholder')}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          enterkeyhint="search"
          onFocus={() => void loadGazetteer().catch(() => {})}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const first = pastedResult ?? admin[0] ?? places[0];
              if (first) pick(first);
            } else if (e.key === 'Escape' && q) {
              e.preventDefault();
              setQ('');
            }
          }}
        />
        {q && (
          <button
            type="button"
            class="btn btn-ghost search-clear"
            aria-label={t('search.clear')}
            onClick={() => {
              setQ('');
              input.current?.focus();
            }}
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      {showPanel && (
        <div class="search-panel">
          <p class="sr-only" role="status">
            {busy ? t('search.searching') : t('search.results', { n: total })}
          </p>
          {pastedResult && (
            <>
              <p class="search-group">{t('search.pasted')}</p>
              <ul>{[pastedResult].map(row)}</ul>
            </>
          )}
          {pasted && pastedFailed && !busy && (
            <p class="search-note">
              {t('search.pastedFailed')}
              <span class="muted small">{t('search.pastedHint')}</span>
            </p>
          )}
          {admin.length > 0 && (
            <>
              <p class="search-group">{t('search.admin')}</p>
              <ul>{admin.map(row)}</ul>
            </>
          )}
          {places.length > 0 && (
            <>
              <p class="search-group">{t('search.places')}</p>
              <ul>{places.map(row)}</ul>
            </>
          )}
          {busy && <p class="search-note muted">{t('search.searching')}</p>}
          {!busy && total === 0 && !pasted && (
            <p class="search-note">
              {t('search.none', { q: query })}
              <span class="muted small">{t('search.noneHint')}</span>
            </p>
          )}
          {placesDown && !busy && <p class="search-note muted small">{t('search.placesDown')}</p>}
          {places.length > 0 && <p class="search-credit muted">{t(provider === 'longdo' ? 'search.creditLongdo' : 'search.credit')}</p>}
        </div>
      )}
    </div>
  );
}
