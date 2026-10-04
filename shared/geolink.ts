// Reading a position out of something the visitor pasted into the search box: plain coordinates
// or a Google Maps link. Only the text of the link is read; no Google service is called.

export interface PastedPlace {
  lat: number;
  lng: number;
  /** Place name taken from the link, when it has one. */
  name: string | null;
}

const inThailand = (lat: number, lng: number) => lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106;

/** "13.7033, 100.4778" or "13.7033 100.4778" (latitude first). */
export function parseCoordinates(text: string): PastedPlace | null {
  const m = /^\s*\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{2,3}(?:\.\d+)?)\s*\)?\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return inThailand(lat, lng) ? { lat, lng, name: null } : null;
}

/** Short share links that must be followed once to find the full address. */
export function isShortMapLink(text: string): boolean {
  return /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\/[A-Za-z0-9_-]+(\?[^\s]*)?$/.test(text.trim());
}

/**
 * Full Google Maps address. The pin is in `!3d<lat>!4d<lng>`; `@lat,lng` is only the centre of
 * the view and can be kilometres away, so it is the last resort.
 */
export function parseGoogleMapsUrl(text: string): PastedPlace | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)google\.[a-z.]+$/.test(url.hostname) || !url.pathname.startsWith('/maps')) return null;
  const full = decodeURIComponent(url.pathname + url.search);
  let name: string | null = null;
  const place = /\/maps\/place\/([^/@]+)/.exec(url.pathname);
  if (place) {
    try {
      name = decodeURIComponent(place[1].replace(/\+/g, ' ')).trim().slice(0, 60) || null;
    } catch {
      name = null;
    }
    // A "place" that is itself coordinates has no name.
    if (name && /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(name)) name = null;
  }
  const pick = (re: RegExp): PastedPlace | null => {
    const m = re.exec(full);
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    return inThailand(lat, lng) ? { lat, lng, name } : null;
  };
  return (
    pick(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ??
    pick(/[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ??
    pick(/\/maps\/place\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ??
    pick(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  );
}

/** Coordinates or a full link, whichever the text is. Short links need the server (see /api/maplink). */
export function parsePasted(text: string): PastedPlace | null {
  return parseCoordinates(text) ?? parseGoogleMapsUrl(text);
}
