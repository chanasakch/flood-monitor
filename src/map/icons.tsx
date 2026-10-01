import { Camera, CloudRain, Construction, Waves } from 'lucide-preact';
import { render, type ComponentType } from 'preact';
import type { LayerType, Level } from '../../shared/types';
import { RoadFloodIcon } from '../components/icons';
import { token } from '../lib/theme';

// Map markers. The outline shape carries the level so it never depends on colour alone:
// circle = normal, triangle = watch, octagon = danger, small grey circle = not current / no data.
// The glyph inside tells which layer the point belongs to.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GLYPH: Record<LayerType, ComponentType<any>> = {
  rain: CloudRain,
  water: Waves,
  road: RoadFloodIcon,
  highway: Construction,
  cctv: Camera,
};

export const LEVELS: Level[] = ['normal', 'watch', 'danger', 'unknown'];
export const LEVEL_RANK: Record<Level, number> = { unknown: 0, normal: 1, watch: 2, danger: 3 };
export const iconName = (type: LayerType, level: Level) => `fm-${type}-${level}`;
export const clusterIconName = (level: Level) => `fm-cluster-${level}`;

/** Inner SVG markup (paths) of an icon component, so it can be embedded in a marker image. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function glyphMarkup(Icon: ComponentType<any>): string {
  const host = document.createElement('div');
  render(<Icon size={24} />, host);
  const inner = host.querySelector('svg')?.innerHTML ?? '';
  render(null, host);
  return inner;
}

function shape(level: Level, s: number, fill: string, stroke: string): string {
  const c = s / 2;
  const sw = s * 0.06;
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"`;
  if (level === 'watch') {
    const p = s * 0.06;
    return `<path d="M${c} ${p} L${s - p} ${s - p * 2.2} L${p} ${s - p * 2.2} Z" ${common}/>`;
  }
  if (level === 'danger') {
    const a = s * 0.29;
    const p = s * 0.05;
    const q = s - p;
    return `<path d="M${a} ${p} L${s - a} ${p} L${q} ${a} L${q} ${s - a} L${s - a} ${q} L${a} ${q} L${p} ${s - a} L${p} ${a} Z" ${common}/>`;
  }
  const r = level === 'unknown' ? s * 0.4 : s * 0.45;
  return `<circle cx="${c}" cy="${c}" r="${r}" ${common}/>`;
}

function svgToImage(svg: string, size: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('marker image failed to load'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export interface MarkerImage {
  name: string;
  image: HTMLImageElement;
}

/** Build every marker image for the current theme. Rendered at 2x for sharp display. */
export async function buildMarkerImages(): Promise<MarkerImage[]> {
  const fills: Record<Level, string> = {
    normal: token('--ok-fill'),
    watch: token('--watch-fill'),
    danger: token('--danger-fill'),
    unknown: token('--stale-fill'),
  };
  const outline = token('--surface');
  // Dark glyph on the amber triangle for contrast, white elsewhere.
  const glyphColor: Record<Level, string> = { normal: '#ffffff', watch: '#1b1300', danger: '#ffffff', unknown: '#ffffff' };
  const jobs: Promise<MarkerImage>[] = [];
  const S = 68; // 34 css px at pixelRatio 2

  for (const type of Object.keys(GLYPH) as LayerType[]) {
    const inner = glyphMarkup(GLYPH[type]);
    for (const level of LEVELS) {
      // Cameras have no level: one neutral marker in the brand colour.
      const fill = type === 'cctv' ? token('--primary') : fills[level];
      const color = type === 'cctv' ? token('--primary-contrast') : glyphColor[level];
      const g = S * 0.44;
      const dy = level === 'watch' ? S * 0.1 : 0;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
        shape(type === 'cctv' ? 'normal' : level, S, fill, outline) +
        `<svg x="${(S - g) / 2}" y="${(S - g) / 2 + dy}" width="${g}" height="${g}" viewBox="0 0 24 24" fill="none" stroke="${color}" ` +
        `stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg></svg>`;
      jobs.push(svgToImage(svg, S).then((image) => ({ name: iconName(type, level), image })));
    }
  }

  const C = 88; // clusters: same shapes, larger, the count is drawn as text on top
  for (const level of LEVELS) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}" viewBox="0 0 ${C} ${C}">${shape(level, C, fills[level], outline)}</svg>`;
    jobs.push(svgToImage(svg, C).then((image) => ({ name: clusterIconName(level), image })));
  }
  return Promise.all(jobs);
}
