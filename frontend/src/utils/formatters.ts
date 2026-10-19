import { Port, Ship } from '../types';

export const km = (a: number, b: number, c: number, d: number): number => {
  const r = Math.PI / 180;
  return Math.hypot((c - a) * r, (d - b) * r * Math.cos(((a + c) * r) / 2)) * 6371;
};

export const dur = (t: number): string => {
  const m = Math.round((Date.now() - t) / 6e4);
  return m < 1 ? '<1 min' : m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};

export const ago = (t?: number | null): string => {
  if (!t) return '';
  return `${dur(t)} ago`;
};

export const flag = (c?: string): string => {
  if (!c) return '';
  return [...c].map(x => String.fromCodePoint(127397 + x.charCodeAt(0))).join('');
};

const displayNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

export const cname = (c?: string): string => {
  if (!c) return '';
  try {
    return displayNames ? displayNames.of(c) || c : c;
  } catch {
    return c;
  }
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const etaFmt = (e?: string): string => {
  if (!e) return '';
  try {
    const [md, hm] = e.split(' ');
    if (!md || !hm) return e;
    const [mo, d] = md.split('-');
    const monthIdx = Number(mo) - 1;
    if (monthIdx < 0 || monthIdx > 11) return e;
    return `${Number(d)} ${MON[monthIdx]} ${hm} UTC`;
  } catch {
    return e;
  }
};

export const findDestPort = (t?: string, ports: Record<string, Port> = {}): Port | null => {
  const d = String(t || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!d) return null;
  return Object.values(ports).find(p => (p.lc && d.includes(p.lc)) || p.k.some(k => d.includes(k))) || null;
};

export const where = (s: Ship, ports: Record<string, Port> = {}): string => {
  if (s.port) {
    const portName = ports[s.port]?.name || '';
    return `${(s.sog || 0) < 2 ? 'At' : 'Near'} ${portName}`;
  }
  return (s.sog || 0) >= 1 ? `${(s.sog as number).toFixed(1)} kn` : 'Stopped';
};

export const getShipColor = (type: 'cargo' | 'tanker', isDark = false): string => {
  if (type === 'tanker') {
    return isDark ? '#ff5a64' : '#e0202e';
  }
  return isDark ? '#7b8fff' : '#2338d6';
};
