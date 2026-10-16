// Listens to AISStream for a few minutes and merges what it hears into data/ships.json.
// Runs on GitHub Actions. Needs the AISSTREAM_API_KEY secret. Only real broadcasts are stored.
import WebSocket from 'ws';
import fs from 'node:fs';

const KEY = process.env.AISSTREAM_API_KEY;
if (!KEY) { console.error('AISSTREAM_API_KEY is not set'); process.exit(1); }
const LISTEN_MS = (Number(process.env.LISTEN_SEC) || 420) * 1000;
const FILE = 'data/ships.json';
const BOX = [[[16.5, 51.0], [28.0, 61.0]]]; // [lat, lon] corners: Oman, UAE, Iran's Hormuz coast
const KEEP_MS = 72 * 3600e3, TRACK_GAP = 600e3, TRACK_MAX = 60;

// Approximate port zones. r = radius in km, lc = UN/LOCODE, k = words seen in AIS destinations.
const PORTS = [
  ['OM', 'Sohar', 24.37, 56.74, 10, 'OMSOH', ['SOHAR']],
  ['OM', 'Muscat', 23.63, 58.57, 10, 'OMMCT', ['MUSCAT', 'MUTRAH', 'QABOOS']],
  ['OM', 'Salalah', 16.95, 54.01, 12, 'OMSLL', ['SALALAH']],
  ['OM', 'Duqm', 19.67, 57.71, 15, 'OMDQM', ['DUQM']],
  ['OM', 'Khasab', 26.18, 56.25, 8, 'OMKHS', ['KHASAB']],
  ['AE', 'Jebel Ali', 25.01, 55.06, 15, 'AEJEA', ['JEBELALI', 'JAFZA']],
  ['AE', 'Dubai', 25.27, 55.28, 8, 'AEDXB', ['DUBAI', 'MINARASHID']],
  ['AE', 'Sharjah', 25.36, 55.38, 8, 'AESHJ', ['SHARJAH', 'HAMRIYAH']],
  ['AE', 'Ajman', 25.41, 55.45, 5, 'AEAJM', ['AJMAN']],
  ['AE', 'Ras Al Khaimah', 25.78, 55.97, 10, 'AERKT', ['RASALKHAIMAH', 'RAKHAIMAH']],
  ['AE', 'Fujairah', 25.17, 56.37, 22, 'AEFJR', ['FUJAIRAH']],
  ['AE', 'Khor Fakkan', 25.34, 56.36, 10, 'AEKLF', ['KHORFAKKAN', 'FAKKAN']],
  ['AE', 'Abu Dhabi', 24.80, 54.65, 15, 'AEAUH', ['ABUDHABI', 'KHALIFAPORT']],
  ['AE', 'Ruwais', 24.11, 52.73, 10, 'AERUW', ['RUWAIS']],
  ['IR', 'Bandar Abbas', 27.13, 56.17, 22, 'IRBND', ['BANDARABBAS', 'SHAHIDRAJAEE', 'RAJAEE']],
  ['IR', 'Bandar Lengeh', 26.56, 54.88, 8, '', ['LENGEH', 'LENGE']],
  ['IR', 'Asaluyeh', 27.47, 52.61, 15, '', ['ASALUYEH', 'ASALOUYEH']],
  ['IR', 'Jask', 25.64, 57.77, 8, 'IRJSK', ['JASK']],
  ['IR', 'Chabahar', 25.29, 60.62, 10, 'IRZBR', ['CHABAHAR', 'BEHESHTI']],
].map(([cc, name, la, lo, r, lc, k]) => ({ id: name.toLowerCase().replace(/\W+/g, '-'), cc, name, la, lo, r, lc, k }));

// Flag from the first three digits of the MMSI (maritime identification digits).
const MID = 'PA:351-357,370-374;LR:636-637;MH:538;HK:477;SG:563-566;MT:215,229,248,249,256;BS:308,309,311;CN:412-414;IN:419;SA:403;QA:466;KW:447;BH:408;PK:463;IR:422;OM:461;AE:470-472;GR:237,239-241;CY:209,210,212;KM:616;TZ:677;TG:671;SL:667;PW:511;KN:341;AG:304,305;BB:314;GI:236;GB:232-235;NO:257-259;DK:219,220;DE:211,218;NL:244-246;IT:247;TR:271;RU:273;JP:431,432;KR:440,441;MY:533;ID:525;TH:567;VN:574;PH:548;EG:622;YE:473,475;IQ:425;LK:417;FR:226-228;ES:224,225;US:338,366-369';
const FLAG = {};
for (const g of MID.split(';')) { const [c, r] = g.split(':'); for (const x of r.split(',')) { const [a, b] = x.split('-').map(Number); for (let i = a; i <= (b || a); i++) FLAG[i] = c; } }
const flagOf = m => FLAG[+String(m).slice(0, 3)] || '';

const km = (a, b, c, d) => { const r = Math.PI / 180; return Math.hypot((c - a) * r, (d - b) * r * Math.cos((a + c) * r / 2)) * 6371; };
const portAt = (la, lo) => { let best = null, bd = 1e9; for (const p of PORTS) { const d = km(la, lo, p.la, p.lo); if (d <= p.r && d < bd) { best = p; bd = d; } } return best; };
const p2 = n => String(n).padStart(2, '0');
const eta = e => e && e.Month >= 1 && e.Month <= 12 && e.Day >= 1 && e.Day <= 31 && e.Hour < 24 && e.Minute < 60 ? `${p2(e.Month)}-${p2(e.Day)} ${p2(e.Hour)}:${p2(e.Minute)}` : '';

let prev = {};
try { prev = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
const state = Object.fromEntries((prev.ships || []).map(s => [s.mmsi, s]));
const pend = {}; // positions heard before the ship's type is known
let msgs = 0, err = null;

function applyPos(s, la, lo, sog, cog, hdg, t) {
  if (s.ts && t < s.ts) return;
  const port = portAt(la, lo);
  if (port) { if (s.port !== port.id) { s.port = port.id; s.arrived = t; } s.last = port.id; s.left = null; }
  else if (s.port) { s.port = null; s.arrived = null; s.left = t; } // first fix outside the zone
  Object.assign(s, { lat: +la.toFixed(5), lon: +lo.toFixed(5), sog, cog, hdg, ts: t });
  const tr = s.track || (s.track = []), l = tr[tr.length - 1];
  if (!l || t - l[2] >= TRACK_GAP || km(l[0], l[1], la, lo) >= 2) { tr.push([+la.toFixed(4), +lo.toFixed(4), t]); if (tr.length > TRACK_MAX) tr.shift(); }
}

function onStatic(mmsi, st, shipName) {
  const tc = Number(st.Type);
  const type = tc >= 70 && tc < 80 ? 'cargo' : tc >= 80 && tc < 90 ? 'tanker' : null;
  if (!type) return; // commercial cargo ships and tankers only
  const s = state[mmsi] || (state[mmsi] = { mmsi, flag: flagOf(mmsi) });
  const d = st.Dimension || {};
  Object.assign(s, {
    name: (st.Name || shipName || '').replace(/@+/g, '').trim() || s.name || mmsi,
    imo: st.ImoNumber ? String(st.ImoNumber) : s.imo, type, tc,
    len: (d.A + d.B) || s.len, beam: (d.C + d.D) || s.beam,
    draught: st.MaximumStaticDraught || s.draught,
    dest: (st.Destination || '').replace(/@+/g, ' ').trim(), eta: eta(st.Eta),
  });
  if (pend[mmsi]) { applyPos(s, ...pend[mmsi]); delete pend[mmsi]; }
}

function handle(m) {
  const meta = m.MetaData || {}, mmsi = String(meta.MMSI || '');
  if (!mmsi) return;
  if (m.MessageType === 'ShipStaticData' && m.Message?.ShipStaticData) return onStatic(mmsi, m.Message.ShipStaticData, meta.ShipName);
  const p = m.Message?.PositionReport;
  if (m.MessageType !== 'PositionReport' || !p) return;
  const la = Number(p.Latitude ?? meta.latitude), lo = Number(p.Longitude ?? meta.longitude);
  if (!(Math.abs(la) <= 90 && Math.abs(lo) <= 180) || (!la && !lo)) return; // 91/181 mean "not available"
  const args = [la, lo, p.Sog >= 102.3 ? null : p.Sog, p.Cog >= 360 ? null : p.Cog, p.TrueHeading >= 360 ? null : p.TrueHeading, Date.now()];
  const s = state[mmsi];
  if (s?.type) applyPos(s, ...args); else pend[mmsi] = args;
}

let saved = false;
function finish() {
  if (saved) return; saved = true;
  const cut = Date.now() - KEEP_MS;
  const ships = Object.values(state).filter(s => s.ts && s.ts > cut).sort((a, b) => b.ts - a.ts);
  const status = !msgs ? (err ? 'error' : 'no_messages') : ships.length ? 'ready' : 'empty';
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({
    meta: { updated: msgs ? new Date().toISOString() : prev.meta?.updated || null, lastRun: new Date().toISOString(), status, error: err, msgs, listenSec: LISTEN_MS / 1000, box: BOX[0], ports: PORTS },
    ships,
  }));
  console.log(JSON.stringify({ status, msgs, ships: ships.length, error: err }));
  process.exit(0);
}

const ws = new WebSocket('wss://stream.aisstream.io/v0/stream', { perMessageDeflate: true });
ws.on('open', () => ws.send(JSON.stringify({ APIKey: KEY, BoundingBoxes: BOX, FilterMessageTypes: ['PositionReport', 'ShipStaticData'] })));
ws.on('message', buf => {
  let m; try { m = JSON.parse(buf.toString()); } catch { return; }
  if (m.error) { err = String(m.error); return; }
  if (m.MessageType === 'SubscriptionConfirmation') return;
  msgs++; handle(m);
});
ws.on('error', e => { err = e.message; });
ws.on('close', finish);
setTimeout(() => ws.close(), LISTEN_MS);
setTimeout(finish, LISTEN_MS + 15000); // safety net if close never fires
