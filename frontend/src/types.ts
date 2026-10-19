export interface Port {
  id: string;
  cc: string;
  name: string;
  la: number;
  lo: number;
  r: number;
  lc: string;
  k: string[];
}

export interface Ship {
  mmsi: string;
  flag?: string;
  name: string;
  imo?: string;
  type: 'cargo' | 'tanker';
  tc?: number;
  len?: number;
  beam?: number;
  draught?: number;
  dest?: string;
  eta?: string;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  hdg?: number | null;
  ts?: number;
  track?: [number, number, number][];
  port?: string | null;
  arrived?: number | null;
  last?: string | null;
  left?: number | null;
}

export interface ShipMeta {
  updated?: string | null;
  lastRun?: string | null;
  status?: string | null;
  error?: string | null;
  msgs?: number;
  listenSec?: number;
  box?: [[number, number], [number, number]];
  ports?: Port[];
}

export interface ShipData {
  meta: ShipMeta;
  ships: Ship[];
}

export type FilterType = 'all' | 'cargo' | 'tanker' | 'moving' | 'port';
export type ViewTab = 'map' | 'list';
