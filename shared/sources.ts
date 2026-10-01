import type { LayerType, SourceId } from './types';

export type SourceKind = 'sensor' | 'radar' | 'forecast' | 'announcement' | 'directory';

export interface SourceInfo {
  id: SourceId;
  name_th: string;
  name_en: string;
  /** Compact name used next to each data point. */
  short_th: string;
  short_en: string;
  /** Official page a visitor can open to see the original data. */
  url: string;
  kind: SourceKind;
  /** Data older than this is shown grey as "not current". Null: not time-critical (camera directory). */
  stale_minutes: number | null;
  layer?: LayerType | 'radar';
}

/** Default staleness thresholds from the project brief. */
export const STALE_MINUTES = {
  sensor: 60,
  /**
   * ThaiWater stations from several agencies report once an hour and are published 1.5-2.5 h
   * after the observation (measured, see SOURCES.md). With the 60 min default more than half of
   * them would be grey at any moment, so these two sources use 3 h. Every value still shows its
   * real observation time.
   */
  hourlyTelemetry: 180,
  radar: 30,
  forecast: 180,
  announcement: 24 * 60,
} as const;

/** An observation time this far ahead of now is treated as unreliable (some stations send future times). */
export const FUTURE_TOLERANCE_MINUTES = 15;

export const SOURCES: Record<SourceId, SourceInfo> = {
  'thaiwater-rain': {
    id: 'thaiwater-rain',
    name_th: 'คลังข้อมูลน้ำแห่งชาติ (ThaiWater) — ฝน',
    name_en: 'ThaiWater (HII) — rainfall',
    short_th: 'ThaiWater (สสน.)',
    short_en: 'ThaiWater (HII)',
    url: 'https://www.thaiwater.net/weather/rainfall',
    kind: 'sensor',
    stale_minutes: STALE_MINUTES.hourlyTelemetry,
    layer: 'rain',
  },
  'thaiwater-water': {
    id: 'thaiwater-water',
    name_th: 'คลังข้อมูลน้ำแห่งชาติ (ThaiWater) — ระดับน้ำ',
    name_en: 'ThaiWater (HII) — water level',
    short_th: 'ThaiWater (สสน.)',
    short_en: 'ThaiWater (HII)',
    url: 'https://www.thaiwater.net/water/wl',
    kind: 'sensor',
    stale_minutes: STALE_MINUTES.hourlyTelemetry,
    layer: 'water',
  },
  'tmd-radar': {
    id: 'tmd-radar',
    name_th: 'กรมอุตุนิยมวิทยา — เรดาร์ฝน',
    name_en: 'Thai Meteorological Department — rain radar',
    short_th: 'กรมอุตุนิยมวิทยา',
    short_en: 'Thai Meteorological Dept.',
    url: 'https://weather.tmd.go.th/composite/index_composite.html',
    kind: 'radar',
    stale_minutes: STALE_MINUTES.radar,
    layer: 'radar',
  },
  'bma-road': {
    id: 'bma-road',
    name_th: 'สำนักการระบายน้ำ กทม. — น้ำท่วมถนน',
    name_en: 'BMA Drainage Department — road flood sensors',
    short_th: 'สำนักการระบายน้ำ กทม.',
    short_en: 'BMA Drainage Dept.',
    url: 'https://weather.bangkok.go.th/flood',
    kind: 'sensor',
    stale_minutes: STALE_MINUTES.sensor,
    layer: 'road',
  },
  'bma-cctv': {
    id: 'bma-cctv',
    name_th: 'กทม. — กล้อง CCTV จราจร',
    name_en: 'BMA — traffic CCTV',
    short_th: 'กทม. (BMA Traffic)',
    short_en: 'BMA Traffic',
    url: 'http://www.bmatraffic.com/index.aspx',
    kind: 'directory',
    stale_minutes: null,
    layer: 'cctv',
  },
  'doh-hdms': {
    id: 'doh-hdms',
    name_th: 'กรมทางหลวง — ศูนย์บริหารงานอุบัติภัย',
    name_en: 'Department of Highways — disaster management centre',
    short_th: 'กรมทางหลวง',
    short_en: 'Dept. of Highways',
    url: 'https://hdms.doh.go.th/dashboard',
    kind: 'announcement',
    stale_minutes: STALE_MINUTES.announcement,
    layer: 'highway',
  },
  'tmd-nwp': {
    id: 'tmd-nwp',
    name_th: 'กรมอุตุนิยมวิทยา — พยากรณ์อากาศเชิงตัวเลข',
    name_en: 'Thai Meteorological Department — NWP forecast',
    short_th: 'กรมอุตุนิยมวิทยา (TMD)',
    short_en: 'Thai Meteorological Dept. (TMD)',
    url: 'https://data.tmd.go.th/nwpapi/doc/',
    kind: 'forecast',
    stale_minutes: STALE_MINUTES.forecast,
  },
  'open-meteo': {
    id: 'open-meteo',
    name_th: 'Open-Meteo',
    name_en: 'Open-Meteo',
    short_th: 'Open-Meteo',
    short_en: 'Open-Meteo',
    url: 'https://open-meteo.com/',
    kind: 'forecast',
    stale_minutes: STALE_MINUTES.forecast,
  },
};

export const SOURCE_IDS = Object.keys(SOURCES) as SourceId[];

export const LAYER_SOURCE: Record<LayerType, SourceId> = {
  rain: 'thaiwater-rain',
  water: 'thaiwater-water',
  road: 'bma-road',
  cctv: 'bma-cctv',
  highway: 'doh-hdms',
};

export const LAYER_TYPES = Object.keys(LAYER_SOURCE) as LayerType[];

/** TMD composite radar image corners, from the official page's own map config. */
export const RADAR_BOUNDS: [number, number, number, number] = [97.5, 5.58, 105.65, 20.48];

/** Rough bounding box of Thailand, used to reject forecast requests for other places. */
export const THAILAND_BBOX = { south: 5.0, north: 21.0, west: 97.0, east: 106.0 };
