import { Map as MapIcon, MapPinPlus, Plus } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { Link } from '../components/Link';
import { PlaceCard } from '../components/PlaceCard';
import { PlaceDialog, readDraft, type PlaceDraft } from '../components/PlaceDialog';
import { CardSkeleton, EmptyState, ErrorState } from '../components/States';
import { Banner, sourceName } from '../components/Status';
import { useAsync, useNow, useSubscription } from '../lib/hooks';
import { t } from '../lib/i18n';
import { failingSources, loadLayers } from '../lib/placeData';
import { getPlace, loadPlaces, onPlacesChange } from '../lib/places';
import { navigate, type Route } from '../lib/router';

const HOME_LAYERS = ['rain', 'water', 'road', 'highway'] as const;

/** Reads `?add=1`, `?edit=<id>` and `?at=lat,lng` (returned by the map's pick mode) into a dialog draft. */
function draftFromQuery(q: URLSearchParams): PlaceDraft | null {
  const at = q.get('at')?.split(',').map(Number);
  const pos = at && at.length === 2 && at.every(Number.isFinite) ? { lat: at[0], lng: at[1] } : {};
  const saved = readDraft();
  const editId = q.get('edit') ?? saved?.id;
  if (q.has('at') && saved) return { ...saved, ...pos };
  if (editId) {
    const p = getPlace(editId);
    if (p) return { ...p, ...pos };
  }
  if (q.has('add') || q.has('at')) return { name: '', kind: 'home', ...pos };
  return null;
}

export function Home({ route }: { route: Route }) {
  useSubscription(onPlacesChange);
  const places = loadPlaces();
  const now = useNow();
  const data = useAsync(() => loadLayers([...HOME_LAYERS]), [], 5 * 60_000);
  const [draft, setDraft] = useState<PlaceDraft | null>(null);

  useEffect(() => {
    setDraft(draftFromQuery(route.query));
  }, [route.query.toString()]);

  const closeDialog = () => {
    setDraft(null);
    if (route.query.toString()) navigate('/', { replace: true });
  };

  const failing = data.data ? failingSources(data.data.layers) : [];

  return (
    <>
      <div class="page-head">
        <h1>{t('home.title')}</h1>
        {places.length > 0 && (
          <button type="button" class="btn btn-primary" onClick={() => setDraft({ name: '', kind: 'home' })}>
            <Plus size={20} aria-hidden="true" />
            {t('home.add')}
          </button>
        )}
      </div>

      {places.length === 0 ? (
        <div class="card">
          <EmptyState icon={<MapPinPlus size={28} aria-hidden="true" />} title={t('home.emptyTitle')} text={t('home.emptyText')}>
            <button type="button" class="btn btn-primary" onClick={() => setDraft({ name: '', kind: 'home' })}>
              <Plus size={20} aria-hidden="true" />
              {t('home.add')}
            </button>
            <Link to="/map" class="btn btn-secondary">
              <MapIcon size={20} aria-hidden="true" />
              {t('home.openMap')}
            </Link>
          </EmptyState>
        </div>
      ) : (
        <>
          <p class="page-intro">{t('home.intro')}</p>
          {failing.length > 0 && (
            <div class="stack-gap">
              <Banner level="info" title={`${t('common.sourceDown')}: ${failing.map((l) => sourceName(l.status!.source)).join(', ')}`}>
                {t('common.sourceDownNote')}
              </Banner>
            </div>
          )}
          {data.error && !data.data ? (
            <div class="card">
              <ErrorState onRetry={data.reload} />
            </div>
          ) : !data.data ? (
            <div class="grid two">
              {places.map((p) => (
                <CardSkeleton key={p.id} lines={5} />
              ))}
            </div>
          ) : (
            <div class="grid two">
              {places.map((p) => (
                <PlaceCard key={p.id} place={p} layers={data.data!.layers} now={now} />
              ))}
            </div>
          )}
        </>
      )}

      <p class="muted small privacy-note">{t('home.storedLocally')}</p>

      {draft && (
        <PlaceDialog
          key={`${draft.id ?? 'new'}:${draft.lat ?? ''}`}
          initial={draft}
          onClose={closeDialog}
          onSaved={() => {
            setDraft(null);
            navigate('/', { replace: true });
          }}
        />
      )}
    </>
  );
}
