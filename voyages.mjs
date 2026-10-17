// voyages.mjs: turns what the collector heard (snapshots of data/ships.json) into a permanent
// record of port calls and voyages. Pure functions: no files, no network, no clock. The clock is
// passed in, so the same input always gives the same output. Used by history.mjs.
//
// Only real broadcasts are used. Nothing is guessed: when the origin of a voyage is not known it is
// reported as unknown.

export const CFG = {
  FLAP_MS: 45 * 60e3,        // leaving and re-entering the same port within this time counts as one stay
  MIN_KM: 3,                 // save a new position only if the ship moved this far...
  HEARTBEAT_MS: 3 * 3600e3,  // ...or if this much time has passed since the last saved one
  TRACK_PTS: 40,             // most points kept on one voyage line
  KEEP_DAYS: 90,             // finished voyages older than this are left out of voyages.json (the raw log keeps them)
};

const R = Math.PI / 180;
export const km = (a, b, c, d) => {   // great-circle distance in km
  const h = Math.sin(((c - a) * R) / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin(((d - b) * R) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Match the free-text destination a crew typed in to one of our ports (same rule the app uses).
export function destPort(text, ports) {
  const d = String(text || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!d) return null;
  return ports.find(p => (p.lc && d.includes(p.lc)) || (p.k || []).some(k => d.includes(k))) || null;
}

export const newStore = () => ({ v: 1, ports: [], vessels: {}, cursor: {} });

// Feed one snapshot of data/ships.json in. Updates the store and returns only what is NEW:
// { events: [{ts, m, e:'arr'|'dep', p, note?}], positions: [[mmsi, ts, lat, lon, sog?]] }.
// Running the same snapshot twice returns nothing the second time.
export function ingest(store, snap) {
  const out = { events: [], positions: [] };
  if (Array.isArray(snap?.meta?.ports) && snap.meta.ports.length) store.ports = snap.meta.ports;
  const ships = (snap?.ships || [])
    .filter(s => s && s.mmsi && Number.isFinite(s.ts))
    .sort((a, b) => (String(a.mmsi) < String(b.mmsi) ? -1 : 1));

  for (const s of ships) {
    const m = String(s.mmsi);
    const c = (store.cursor[m] ||= { seen: false, port: null, ts: 0, posTs: 0, stored: null });
    if (c.seen && s.ts <= c.ts) continue;   // nothing newer than what we already have
    const v = (store.vessels[m] ||= { mmsi: m, firstSeen: null, lastSeen: 0 });
    for (const k of ['imo', 'name', 'flag', 'type', 'len', 'beam', 'draught', 'dest', 'eta'])
      if (s[k] !== undefined && s[k] !== null && s[k] !== '') v[k] = s[k];
    v.pos = [s.lat, s.lon, s.ts];
    v.sog = s.sog ?? null;

    // Positions: the collector keeps a short trail per ship; save the new points, thinned.
    const pts = [...(s.track || []).map(p => ({ la: p[0], lo: p[1], t: p[2] })), { la: s.lat, lo: s.lon, t: s.ts, sog: s.sog }]
      .filter(p => Number.isFinite(p.la) && Number.isFinite(p.lo) && Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    v.firstSeen = Math.min(v.firstSeen ?? Infinity, pts[0]?.t ?? s.ts);
    v.lastSeen = Math.max(v.lastSeen, s.ts);
    for (const p of pts) {
      if (p.t <= c.posTs) continue;
      c.posTs = p.t;
      if (!c.stored || km(c.stored[0], c.stored[1], p.la, p.lo) >= CFG.MIN_KM || p.t - c.stored[2] >= CFG.HEARTBEAT_MS) {
        c.stored = [p.la, p.lo, p.t];
        out.positions.push(p.sog != null ? [m, p.t, p.la, p.lo, p.sog] : [m, p.t, p.la, p.lo]);
      }
    }

    // Port events: compare with the port this ship was in at the previous snapshot.
    const ev = (e, p, ts, note) => out.events.push(note ? { ts, m, e, p, note } : { ts, m, e, p });
    const now = s.port || null;
    if (!c.seen) {
      if (now) ev('arr', now, s.arrived ?? s.ts, 'first_seen');            // arrival time = first time heard inside
      else if (s.left && s.last) ev('dep', s.last, s.left, 'inferred');    // the collector remembers it left s.last
    } else if (now !== c.port) {
      if (c.port && now) { const t = s.arrived ?? s.ts; ev('dep', c.port, t, 'approx'); ev('arr', now, t); }
      else if (c.port) ev('dep', c.port, s.left ?? s.ts);
      else ev('arr', now, s.arrived ?? s.ts);
    }
    Object.assign(c, { seen: true, port: now, ts: s.ts });
  }
  return out;
}

// Leaving and re-entering the same port within FLAP_MS is GPS jitter at the zone edge: one stay.
function debounce(list) {
  const out = [];
  for (const e of list) {
    const p = out[out.length - 1];
    if (e.e === 'arr' && e.note !== 'first_seen' && p && p.e === 'dep' && p.p === e.p && e.ts - p.ts <= CFG.FLAP_MS) out.pop();
    else out.push(e);
  }
  return out;
}

const sample = (a, n) => (a.length <= n ? a : Array.from({ length: n }, (_, i) => a[Math.round((i * (a.length - 1)) / (n - 1))]));
const r1 = x => Math.round(x * 10) / 10;

// Build the voyage list from the permanent log. Pure: same inputs, same output.
export function buildVoyages({ vessels, events, positions, ports = [], now = Date.now() }) {
  const P = Object.fromEntries(ports.map(p => [p.id, p]));
  const evs = {}, pos = {}, seenE = new Set(), seenP = new Set();
  for (const e of events) { const k = `${e.m}|${e.e}|${e.p}|${e.ts}`; if (!seenE.has(k)) { seenE.add(k); (evs[e.m] ||= []).push(e); } }
  for (const p of positions) { const k = `${p[0]}|${p[1]}`; if (!seenP.has(k)) { seenP.add(k); (pos[p[0]] ||= []).push(p); } }
  const cutoff = now - CFG.KEEP_DAYS * 864e5;
  const ord = e => (e.e === 'dep' ? 0 : 1);
  const list = [];
  const tally = { inPort: 0, atSea: 0, completed: 0, incomplete: 0, calls: 0 };

  for (const m of Object.keys(vessels).sort()) {
    const v = vessels[m];
    const pts = (pos[m] || []).sort((a, b) => a[1] - b[1]);
    const calls = [], voyages = [];
    let call = null, leg = null;

    for (const e of debounce((evs[m] || []).sort((a, b) => a.ts - b.ts || ord(a) - ord(b)))) {
      if (e.e === 'arr') {
        if (call) { calls.push(call); call = null; }   // a stay whose departure was never heard
        if (!leg && e.note !== 'first_seen') leg = { from: null, fromKnown: false, departed: null, startedObs: v.firstSeen };
        if (leg) { voyages.push({ ...leg, to: e.p, arrived: e.ts, status: 'completed' }); leg = null; }
        call = { port: e.p, arrived: e.ts, arrivalKnown: e.note !== 'first_seen', departed: null };
      } else {
        if (leg) { voyages.push({ ...leg, to: null, arrived: null, status: 'incomplete' }); leg = null; }   // arrival never heard
        if (call && call.port === e.p) { call.departed = e.ts; calls.push(call); }
        else { if (call) calls.push(call); calls.push({ port: e.p, arrived: null, arrivalKnown: false, departed: e.ts }); }
        call = null;
        leg = { from: e.p, fromKnown: true, departed: e.ts, ...(e.note ? { note: e.note } : {}) };
      }
    }
    if (!call && !leg) leg = { from: null, fromKnown: false, departed: null, startedObs: v.firstSeen };   // first heard at sea
    if (leg) leg = { ...leg, to: null, arrived: null, status: 'in_progress' };

    const finish = L => {
      const t0 = L.departed ?? L.startedObs ?? 0, t1 = L.arrived ?? v.lastSeen;
      const seen = pts.filter(p => p[1] >= t0 && p[1] <= t1);
      const path = [];
      if (L.from && P[L.from]) path.push([P[L.from].la, P[L.from].lo]);
      seen.forEach(p => path.push([p[2], p[3]]));
      if (L.to && P[L.to]) path.push([P[L.to].la, P[L.to].lo]);
      let d = 0;
      for (let i = 1; i < path.length; i++) d += km(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
      L.distanceKmEst = path.length > 1 ? Math.round(d) : null;   // observed positions plus port centres
      if (L.departed && L.arrived && L.note !== 'approx') {
        L.durationH = r1((L.arrived - L.departed) / 3.6e6);
        if (L.durationH >= 0.25 && d > 0) L.avgKnEst = r1(d / 1.852 / L.durationH);
      }
      L.positionsSaved = seen.length;
      L.track = sample(seen, CFG.TRACK_PTS).map(p => [p[2], p[3], p[1]]);
      if (L.status === 'in_progress') {
        const dp = destPort(v.dest, ports);
        L.destText = v.dest || null;
        L.destPort = dp ? dp.id : null;
        L.silentH = r1((now - v.lastSeen) / 3.6e6);
        if (dp && v.pos) L.remainingKmEst = Math.round(km(v.pos[0], v.pos[1], dp.la, dp.lo));   // straight line
      }
      return L;
    };

    const kept = voyages.filter(x => (x.arrived ?? now) >= cutoff).map(finish);
    if (leg) kept.push(finish(leg));
    const keptCalls = calls.filter(x => (x.departed ?? now) >= cutoff);
    if (call) keptCalls.push(call);
    kept.sort((a, b) => (b.arrived ?? b.departed ?? now) - (a.arrived ?? a.departed ?? now));
    keptCalls.sort((a, b) => (b.departed ?? b.arrived ?? now) - (a.departed ?? a.arrived ?? now));

    call ? tally.inPort++ : tally.atSea++;
    tally.completed += kept.filter(x => x.status === 'completed').length;
    tally.incomplete += kept.filter(x => x.status === 'incomplete').length;
    tally.calls += keptCalls.length;
    list.push({
      mmsi: m, imo: v.imo ?? null, name: v.name ?? m, flag: v.flag ?? null, type: v.type ?? null,
      firstSeen: v.firstSeen, lastSeen: v.lastSeen, pos: v.pos ?? null, sog: v.sog ?? null,
      now: call ? { state: 'in_port', port: call.port, since: call.arrived, sinceKnown: call.arrivalKnown } : { state: 'at_sea' },
      calls: keptCalls, voyages: kept,
    });
  }
  list.sort((a, b) => b.lastSeen - a.lastSeen || (a.mmsi < b.mmsi ? -1 : 1));

  return {
    meta: {
      schema: 1, generated: new Date(now).toISOString(), vessels: list.length, ...tally,
      eventsRead: seenE.size, positionsRead: seenP.size, keptDays: CFG.KEEP_DAYS,
      notes: [
        'Origin unknown means the vessel was first heard at sea, so its earlier port is not in the record.',
        'Arrival and departure times are when the collector first heard the vessel inside or outside a port zone.',
        'Distances are estimates built from saved positions and port centres.',
      ],
    },
    vessels: list,
  };
}
