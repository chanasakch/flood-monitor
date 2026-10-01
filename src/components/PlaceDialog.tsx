import { LocateFixed, MapPin, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { inThailand } from '../lib/geo';
import { t } from '../lib/i18n';
import { savePlace, type Place, type PlaceKind } from '../lib/places';
import { navigate } from '../lib/router';
import { KIND_ICON } from './PlaceCard';

const DRAFT_KEY = 'fm.placeDraft';
const KINDS: PlaceKind[] = ['home', 'work', 'school', 'other'];

export interface PlaceDraft {
  id?: string;
  name: string;
  kind: PlaceKind;
  lat?: number;
  lng?: number;
}

/** The draft survives the trip to the map and back when the user picks a location there. */
export function readDraft(): PlaceDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as PlaceDraft) : null;
  } catch {
    return null;
  }
}
function writeDraft(d: PlaceDraft | null): void {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

interface Props {
  initial: PlaceDraft;
  onClose: () => void;
  onSaved: (place: Place) => void;
}

export function PlaceDialog({ initial, onClose, onSaved }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initial.name);
  const [kind, setKind] = useState<PlaceKind>(initial.kind);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(
    initial.lat != null && initial.lng != null ? { lat: initial.lat, lng: initial.lng } : null,
  );
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const close = () => {
    writeDraft(null);
    onClose();
  };

  const useCurrent = () => {
    if (!navigator.geolocation) {
      setError(t('place.locateFailed'));
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        if (!inThailand(p.coords.latitude, p.coords.longitude)) setError(t('place.outside'));
        else setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (e) => {
        setLocating(false);
        setError(t(e.code === e.PERMISSION_DENIED ? 'place.locateDenied' : 'place.locateFailed'));
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60_000 },
    );
  };

  const pickOnMap = () => {
    writeDraft({ id: initial.id, name, kind, ...(pos ?? {}) });
    const at = pos ? `&lat=${pos.lat}&lng=${pos.lng}&z=14` : '';
    navigate(`/map?pick=1${at}`);
  };

  const submit = (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return setError(t('place.nameRequired'));
    if (!pos) return setError(t('place.locationRequired'));
    const saved = savePlace({ id: initial.id, name, kind, lat: pos.lat, lng: pos.lng });
    if (!saved) return setError(t('common.loadError'));
    writeDraft(null);
    onSaved(saved);
  };

  return (
    <dialog ref={ref} class="dialog" aria-labelledby="place-dialog-title" onCancel={close} onClose={close}>
      <form onSubmit={submit} novalidate>
        <div class="dialog-head">
          <h2 id="place-dialog-title">{t(initial.id ? 'place.editTitle' : 'place.addTitle')}</h2>
          <button type="button" class="btn btn-ghost" onClick={close} aria-label={t('common.close')}>
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <label class="field">
          <span class="field-label">{t('place.name')}</span>
          <input
            type="text"
            class="input"
            value={name}
            maxLength={60}
            placeholder={t('place.namePlaceholder')}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            autocomplete="off"
            required
          />
        </label>

        <fieldset class="field">
          <legend class="field-label">{t('place.kind')}</legend>
          <div class="kind-options">
            {KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <label key={k} class={`kind-option${kind === k ? ' is-on' : ''}`}>
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} class="sr-only" />
                  <Icon size={20} aria-hidden="true" />
                  {t(`place.kind${k[0].toUpperCase()}${k.slice(1)}`)}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div class="field">
          <span class="field-label">{t('place.location')}</span>
          <p class={`loc-status${pos ? ' is-set' : ''}`} role="status">
            <MapPin size={18} aria-hidden="true" />
            {locating
              ? t('place.locating')
              : pos
                ? t('place.picked', { lat: pos.lat.toFixed(4), lng: pos.lng.toFixed(4) })
                : t('place.notPicked')}
          </p>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" onClick={useCurrent} disabled={locating}>
              <LocateFixed size={18} aria-hidden="true" />
              {t('place.useCurrent')}
            </button>
            <button type="button" class="btn btn-secondary" onClick={pickOnMap}>
              <MapPin size={18} aria-hidden="true" />
              {t('place.pickOnMap')}
            </button>
          </div>
        </div>

        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}

        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" class="btn btn-primary">
            {t('common.save')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
