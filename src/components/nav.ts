import { Database, House, Info, Map as MapIcon } from 'lucide-preact';

export const NAV_ITEMS = [
  { to: '/', label: 'nav.home', icon: House, match: (p: string) => p === '/' || p.startsWith('/place') },
  { to: '/map', label: 'nav.map', icon: MapIcon, match: (p: string) => p.startsWith('/map') },
  { to: '/sources', label: 'nav.sources', icon: Database, match: (p: string) => p.startsWith('/sources') },
  { to: '/about', label: 'nav.about', icon: Info, match: (p: string) => p.startsWith('/about') },
] as const;
