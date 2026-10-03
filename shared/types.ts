// Types shared by the Worker and the frontend.

export type LayerType = 'rain' | 'water' | 'road' | 'cctv' | 'highway';

/** Alert level. `unknown` means the source gave no usable value: shown as "no data", never as "not flooded". */
export type Level = 'normal' | 'watch' | 'danger' | 'unknown';

export type SourceId =
  | 'thaiwater-rain'
  | 'thaiwater-water'
  | 'tmd-radar'
  | 'bma-road'
  | 'bma-cctv'
  | 'doh-hdms'
  | 'tmd-nwp'
  | 'open-meteo';

/** Common schema every fetcher normalises to. */
export interface Reading {
  id: string;
  type: LayerType;
  lat: number;
  lng: number;
  /** Measured value, or null when the source reported none. */
  value: number | null;
  unit: string;
  level: Level;
  /** ISO 8601 with offset, as observed at the source. Null when the source gave no time. */
  observed_at: string | null;
  source: SourceId;
  /** Link to the original page for this data point. */
  source_url: string;
  name_th: string;
  name_en: string | null;
  /** Layer-specific fields (province, 1 h rain, bank level, ...). */
  extra?: Record<string, string | number | boolean | null>;
}

/** Fields identical for every item in a layer are sent once in `defaults`. */
export type PackedReading = Partial<Reading> & Pick<Reading, 'id' | 'lat' | 'lng'>;

export interface SourceStatus {
  source: SourceId;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  item_count: number | null;
  duration_ms: number | null;
}

export interface LayerResponse {
  type: LayerType;
  /** When our Worker last fetched this layer successfully. Null if it never has. */
  fetched_at: string | null;
  status: SourceStatus | null;
  /** True when this request started a background refresh: ask again in a few seconds for newer data. */
  refreshing?: boolean;
  defaults: Partial<Reading>;
  items: PackedReading[];
}

export interface RadarResponse {
  /** Observation time of the frame (ISO, UTC). Null when no frame is available. */
  observed_at: string | null;
  fetched_at: string | null;
  image_url: string | null;
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
  source: SourceId;
  source_url: string;
  status: SourceStatus | null;
}

export interface ForecastHour {
  /** ISO 8601 with +07:00 offset, start of the hour. */
  time: string;
  /** Rain in that hour, mm. */
  mm: number | null;
  /** Probability of precipitation, %. Only Open-Meteo provides it. */
  prob?: number | null;
  /** TMD weather condition code 1-12. */
  cond?: number | null;
}

export interface ForecastPart {
  ok: boolean;
  source: SourceId;
  source_url: string;
  /** When this part was fetched from the upstream. */
  fetched_at: string | null;
  error?: string;
  hours: ForecastHour[];
}

export interface ForecastResponse {
  lat: number;
  lng: number;
  /** Source used for the mm/h bars: TMD when available, otherwise Open-Meteo, otherwise null. */
  primary: 'tmd-nwp' | 'open-meteo' | null;
  tmd: ForecastPart;
  openmeteo: ForecastPart;
}

export interface HistoryPoint {
  /** ISO 8601 with offset. */
  time: string;
  value: number | null;
}

export interface HistoryResponse {
  id: string;
  unit: string;
  source: SourceId;
  source_url: string;
  fetched_at: string | null;
  /** True when the upstream failed and an older cached answer is returned. */
  stale: boolean;
  error?: string;
  points: HistoryPoint[];
  /** Reference lines for water level charts (m MSL). */
  thresholds?: { bank: number | null; ground: number | null };
}

export interface AlertsStatus {
  /** A LINE token is set. */
  configured: boolean;
  /** Last token check: true ok, false failed, null never checked. */
  account_ok: boolean | null;
  account_name: string | null;
  account_error: string | null;
  checked_at: string | null;
  quota: number | null;
  used: number | null;
  sent_this_month: number;
  cap: number;
  max_per_day: number;
  min_gap_hours: number;
  last_sent_at: string | null;
  last_ok: boolean | null;
  last_error: string | null;
  areas: string[];
}

export interface SourcesResponse {
  now: string;
  alerts?: AlertsStatus;
  sources: SourceStatus[];
  recent_errors: { source: SourceId; at: string; ok: boolean; message: string | null }[];
}

/** One place found by the search box. */
export interface SearchResult {
  name: string;
  /** Where it is, e.g. district and province. */
  detail: string;
  lat: number;
  lng: number;
  /** `admin`: subdistrict, district or province from the built-in list. `osm`: a named place from OpenStreetMap. */
  source: 'admin' | 'osm';
}

export interface SearchResponse {
  q: string;
  results: SearchResult[];
  /** Set when the place-name service could not be reached; the built-in list still works. */
  error?: string;
}

export interface LineUser {
  user_id: string;
  display_name: string | null;
  following: boolean;
  first_seen: string;
  last_seen: string;
}

export interface AdminLineState {
  configured: boolean;
  account: { name: string | null; quota: number | null; used: number | null; error?: string } | null;
  webhook: { endpoint: string | null; active: boolean } | null;
  users: LineUser[];
  recent: { sent_at: string; kind: string; areas: string; message: string; ok: number; error: string | null; recipients: number | null }[];
}
