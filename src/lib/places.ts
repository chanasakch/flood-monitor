export type PlaceKind = 'home' | 'work' | 'school' | 'other';

export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
}

const KEY = 'fm.places';
const listeners = new Set<() => void>();

function isPlace(p: unknown): p is Place {
  const x = p as Place;
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    ['home', 'work', 'school', 'other'].includes(x.kind) &&
    Number.isFinite(x.lat) &&
    Number.isFinite(x.lng)
  );
}

/** Saved places live only in this browser's localStorage. They are never sent to the server. */
export function loadPlaces(): Place[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isPlace) : [];
  } catch {
    return [];
  }
}

function store(places: Place[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(places));
  } catch {
    return false;
  }
  listeners.forEach((fn) => fn());
  return true;
}

export function onPlacesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getPlace(id: string): Place | undefined {
  return loadPlaces().find((p) => p.id === id);
}

export function savePlace(input: Omit<Place, 'id'> & { id?: string }): Place | null {
  const places = loadPlaces();
  const place: Place = {
    id: input.id ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim().slice(0, 60),
    kind: input.kind,
    // ~1 m precision is plenty and avoids storing a more exact home location than needed.
    lat: Math.round(input.lat * 1e5) / 1e5,
    lng: Math.round(input.lng * 1e5) / 1e5,
  };
  const i = places.findIndex((p) => p.id === place.id);
  if (i >= 0) places[i] = place;
  else places.push(place);
  return store(places) ? place : null;
}

export function deletePlace(id: string): void {
  store(loadPlaces().filter((p) => p.id !== id));
}
