import {
  AttributionControl,
  GeolocateControl,
  Map as MlMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type ImageSource,
  type MapMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection, Point } from 'geojson';
import { useEffect, useRef } from 'preact/hooks';
import type { Freshness } from '../../shared/levels';
import type { LayerType, RadarResponse, Reading } from '../../shared/types';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import type { Layers } from '../lib/placeData';
import { shown } from '../lib/status';
import { effectiveTheme, onThemeChange, token } from '../lib/theme';
import { buildMarkerImages, clusterIconName, iconName, LEVEL_RANK } from './icons';

setWorkerUrl(workerUrl);

const STYLE = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;

/** Draw order, bottom to top. Road sensors are the most local signal, so they sit on top. */
const POINT_LAYERS: LayerType[] = ['cctv', 'highway', 'rain', 'water', 'road'];
const CLUSTER_MAX_ZOOM: Record<LayerType, number> = { rain: 11, water: 9, road: 12, highway: 9, cctv: 14 };
const THAILAND: [[number, number], [number, number]] = [
  [97.3, 5.5],
  [105.7, 20.6],
];

export type LayerKey = LayerType | 'radar';

export interface MapViewProps {
  layers: Layers;
  radar: RadarResponse | null;
  radarFresh: Freshness;
  visible: Record<LayerKey, boolean>;
  now: number;
  mode3d: boolean;
  initialView: { lat: number; lng: number; zoom: number } | null;
  /** Highlighted position: the selected marker or the tapped point. */
  pin: { lat: number; lng: number } | null;
  onSelect: (reading: Reading) => void;
  onPoint: (pos: { lat: number; lng: number }) => void;
  /** Called when 3D is turned off automatically because rendering is too slow. */
  onSlow: () => void;
}

function valueLabel(r: Reading): string {
  if (r.value == null || r.type === 'cctv' || r.type === 'highway') return '';
  return formatNumber(r.value, r.type === 'water' ? 1 : 0);
}

function toGeoJson(items: Reading[], now: number): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.map((r) => {
      const s = shown(r, now);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          id: r.id,
          rank: LEVEL_RANK[s.level],
          icon: iconName(r.type, s.level),
          // Stale values are not printed on the map; the grey marker already says "not current".
          label: s.fresh === 'fresh' ? valueLabel(r) : '',
        },
      };
    }),
  };
}

export default function MapView(props: MapViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const pinRef = useRef<Marker | null>(null);
  const latest = useRef(props);
  latest.current = props;
  /** Readings by id, for click lookups. */
  const index = useRef(new Map<string, Reading>());

  // ---- push the current props into the map (idempotent, called after every change and style load) ----
  const sync = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const p = latest.current;

    for (const type of POINT_LAYERS) {
      const src = `fm-${type}`;
      const items = p.visible[type] ? (p.layers[type]?.items ?? []) : [];
      for (const r of items) index.current.set(r.id, r);
      const data = toGeoJson(items, p.now);
      const existing = map.getSource(src) as GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
        continue;
      }
      map.addSource(src, {
        type: 'geojson',
        data,
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: CLUSTER_MAX_ZOOM[type],
        // A cluster takes the worst level inside it, so an alert is never hidden by zooming out.
        clusterProperties: { maxRank: ['max', ['get', 'rank']] },
      });
      map.addLayer({
        id: `${src}-cluster`,
        type: 'symbol',
        source: src,
        filter: ['has', 'point_count'],
        layout: {
          'icon-image':
            type === 'cctv'
              ? clusterIconName('unknown')
              : ['match', ['get', 'maxRank'], 3, clusterIconName('danger'), 2, clusterIconName('watch'), 1, clusterIconName('normal'), clusterIconName('unknown')],
          'icon-size': ['interpolate', ['linear'], ['get', 'point_count'], 2, 0.72, 100, 0.9, 1000, 1.08],
          'icon-allow-overlap': true,
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 13,
          'text-allow-overlap': true,
          'text-offset': ['match', ['get', 'maxRank'], 2, ['literal', [0, 0.25]], ['literal', [0, 0]]],
          'symbol-sort-key': ['-', 0, ['get', 'maxRank']],
        },
        paint: { 'text-color': ['match', ['get', 'maxRank'], 2, '#1b1300', '#ffffff'] },
      });
      map.addLayer({
        id: `${src}-point`,
        type: 'symbol',
        source: src,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.62, 10, 0.82, 14, 1],
          'icon-allow-overlap': true,
          'symbol-sort-key': ['get', 'rank'],
          'text-field': ['step', ['zoom'], '', 11, ['get', 'label']],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-offset': [0, 1.5],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': token('--text'),
          'text-halo-color': token('--surface'),
          'text-halo-width': 1.6,
        },
      });
    }

    // Radar: one image, drawn below every marker. Grey when it is not current.
    const radarUrl = p.visible.radar ? (p.radar?.image_url ?? null) : null;
    const src = map.getSource('fm-radar') as ImageSource | undefined;
    if (!radarUrl) {
      if (map.getLayer('fm-radar')) map.removeLayer('fm-radar');
      if (src) map.removeSource('fm-radar');
    } else {
      const [w, s, e, n] = p.radar!.bounds;
      const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
        [w, n],
        [e, n],
        [e, s],
        [w, s],
      ];
      if (!src) {
        map.addSource('fm-radar', { type: 'image', url: radarUrl, coordinates });
        map.addLayer({ id: 'fm-radar', type: 'raster', source: 'fm-radar', paint: { 'raster-fade-duration': 0 } }, `fm-${POINT_LAYERS[0]}-cluster`);
      } else if (src.url !== radarUrl) {
        src.updateImage({ url: radarUrl, coordinates });
      }
      const stale = p.radarFresh !== 'fresh';
      map.setPaintProperty('fm-radar', 'raster-saturation', stale ? -1 : 0);
      map.setPaintProperty('fm-radar', 'raster-opacity', stale ? 0.4 : 0.78);
    }

    // 3D: pitch plus extruded buildings from the base map's own building data.
    const has3d = !!map.getLayer('fm-3d');
    if (p.mode3d && !has3d) {
      const vector = Object.entries(map.getStyle().sources).find(([, s]) => s.type === 'vector')?.[0];
      if (vector) {
        map.addLayer(
          {
            id: 'fm-3d',
            type: 'fill-extrusion',
            source: vector,
            'source-layer': 'building',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': token('--border-strong'),
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.75,
            },
          },
          map.getLayer('fm-radar') ? 'fm-radar' : `fm-${POINT_LAYERS[0]}-cluster`,
        );
      }
      map.easeTo({ pitch: 55, duration: 600 });
    } else if (!p.mode3d && has3d) {
      map.removeLayer('fm-3d');
      map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
    }
  };

  // ---- create the map once ----
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const view = latest.current.initialView;
    const map = new MlMap({
      container: el,
      style: STYLE[effectiveTheme()],
      ...(view ? { center: [view.lng, view.lat] as [number, number], zoom: view.zoom } : { bounds: THAILAND, fitBoundsOptions: { padding: 24 } }),
      minZoom: 4,
      maxZoom: 18,
      maxPitch: 60,
      maxBounds: [
        [88, -2],
        [114, 28],
      ],
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: false }, trackUserLocation: false }), 'top-right');
    map.getCanvas().setAttribute('aria-label', t('map.title'));

    let disposed = false;
    const install = async () => {
      // A new style drops custom images, sources and layers: add them again.
      readyRef.current = false;
      try {
        const images = await buildMarkerImages();
        if (disposed) return;
        for (const { name, image } of images) {
          if (map.hasImage(name)) map.updateImage(name, image);
          else map.addImage(name, image, { pixelRatio: 2 });
        }
      } catch (e) {
        console.error(e);
      }
      readyRef.current = true;
      sync();
    };
    map.on('style.load', install);

    const interactive = () => POINT_LAYERS.flatMap((type) => [`fm-${type}-point`, `fm-${type}-cluster`]).filter((id) => map.getLayer(id));
    map.on('click', (e: MapMouseEvent) => {
      // Generous hit box so markers are easy to tap.
      const box: [[number, number], [number, number]] = [
        [e.point.x - 14, e.point.y - 14],
        [e.point.x + 14, e.point.y + 14],
      ];
      const hits = map.queryRenderedFeatures(box, { layers: interactive() });
      const point = hits.find((f) => !f.properties.point_count);
      if (point) {
        const reading = index.current.get(point.properties.id as string);
        if (reading) return latest.current.onSelect(reading);
      }
      const cluster = hits.find((f) => f.properties.point_count);
      if (cluster) {
        const source = map.getSource(cluster.source) as GeoJSONSource;
        const center = (cluster.geometry as Point).coordinates as [number, number];
        source
          .getClusterExpansionZoom(cluster.properties.cluster_id as number)
          .then((zoom) => map.easeTo({ center, zoom: Math.min(zoom + 0.5, 17) }))
          .catch(() => map.easeTo({ center, zoom: map.getZoom() + 2 }));
        return;
      }
      latest.current.onPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.on('mousemove', (e) => {
      map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: interactive() }).length ? 'pointer' : '';
    });

    // Auto-disable 3D on slow devices: watch frame intervals while 3D is on and the map is animating.
    let lastFrame = 0;
    let slowFrames = 0;
    let frames = 0;
    map.on('render', () => {
      if (!latest.current.mode3d) {
        lastFrame = 0;
        frames = slowFrames = 0;
        return;
      }
      const nowMs = performance.now();
      const delta = nowMs - lastFrame;
      lastFrame = nowMs;
      if (delta > 400) return; // idle gap, not a slow frame
      frames++;
      if (delta > 50) slowFrames++;
      if (frames >= 60) {
        if (slowFrames / frames > 0.5) latest.current.onSlow();
        frames = slowFrames = 0;
      }
    });

    const offTheme = onThemeChange(() => map.setStyle(STYLE[effectiveTheme()]));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);

    return () => {
      disposed = true;
      offTheme();
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- keep the map in step with props ----
  useEffect(sync, [props.layers, props.radar, props.radarFresh, props.visible, props.mode3d, Math.floor(props.now / 60000)]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pinRef.current?.remove();
    pinRef.current = null;
    if (props.pin) {
      const el = document.createElement('div');
      el.className = 'map-pin';
      pinRef.current = new Marker({ element: el }).setLngLat([props.pin.lng, props.pin.lat]).addTo(map);
    }
  }, [props.pin?.lat, props.pin?.lng]);

  return <div ref={host} class="map-canvas" />;
}
