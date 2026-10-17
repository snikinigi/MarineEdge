// Run with: node --test
// All vessels below ("TEST-A" and so on) are made-up fixtures that exist only inside these tests.
// They are never written to your data files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { km, newStore, ingest, buildVoyages, destPort } from './voyages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.UTC(2026, 9, 1), H = 3.6e6;
const PORTS = [
  { id: 'dubai', cc: 'AE', name: 'Dubai', la: 25.27, lo: 55.28, r: 8, lc: 'AEDXB', k: ['DUBAI'] },
  { id: 'fujairah', cc: 'AE', name: 'Fujairah', la: 25.17, lo: 56.37, r: 22, lc: 'AEFJR', k: ['FUJAIRAH'] },
  { id: 'sohar', cc: 'OM', name: 'Sohar', la: 24.37, lo: 56.74, r: 10, lc: 'OMSOH', k: ['SOHAR'] },
];
const ship = o => ({ mmsi: '999000001', name: 'TEST-A', imo: '0000001', type: 'tanker', flag: 'PA', lat: 25, lon: 55, sog: 0, cog: null, hdg: null,
  ts: T0, track: [], port: null, arrived: null, last: null, left: null, dest: '', ...o });
const snap = (ships, t) => ({ meta: { updated: new Date(t).toISOString(), ports: PORTS }, ships });
const run = (store, snaps) => {
  const events = [], positions = [];
  for (const s of snaps) { const r = ingest(store, s); events.push(...r.events); positions.push(...r.positions); }
  return { events, positions };
};
const build = (store, log, now) => buildVoyages({ vessels: store.vessels, ...log, ports: PORTS, now });
const A = id => id.vessels.find(v => v.mmsi === '999000001');

// A full trip: in Dubai, leaves, arrives Fujairah.
const trip = () => [
  snap([ship({ lat: 25.27, lon: 55.28, ts: T0, port: 'dubai', arrived: T0, last: 'dubai' })], T0),
  snap([ship({ lat: 25.2, lon: 55.8, sog: 12, ts: T0 + 3 * H, last: 'dubai', left: T0 + H,
    track: [[25.27, 55.28, T0], [25.25, 55.5, T0 + 1.5 * H]] })], T0 + 3 * H),
  snap([ship({ lat: 25.17, lon: 56.37, ts: T0 + 6 * H, port: 'fujairah', arrived: T0 + 5.5 * H, last: 'fujairah', left: T0 + H,
    track: [[25.27, 55.28, T0], [25.25, 55.5, T0 + 1.5 * H], [25.2, 55.8, T0 + 3 * H], [25.18, 56.2, T0 + 5 * H]] })], T0 + 6 * H),
];

test('distance: Dubai to Fujairah is about 110 km', () => {
  const d = km(25.27, 55.28, 25.17, 56.37);
  assert.ok(d > 105 && d < 115, String(d));
});

test('destination text is matched to a port, and junk is not', () => {
  assert.equal(destPort('AE FJR', PORTS)?.id, 'fujairah');
  assert.equal(destPort('FOR ORDERS', PORTS), null);
  assert.equal(destPort('', PORTS), null);
});

test('first seen inside a port: stay recorded, arrival flagged as first heard, no voyage invented', () => {
  const st = newStore();
  const log = run(st, [trip()[0]]);
  assert.deepEqual(log.events.map(e => [e.e, e.p, e.note]), [['arr', 'dubai', 'first_seen']]);
  const v = A(build(st, log, T0 + H));
  assert.equal(v.now.state, 'in_port');
  assert.equal(v.now.sinceKnown, false);
  assert.equal(v.voyages.length, 0);
});

test('complete voyage Dubai to Fujairah is reconstructed with times and distance', () => {
  const st = newStore();
  const out = build(st, run(st, trip()), T0 + 7 * H);
  const v = A(out);
  assert.equal(out.meta.completed, 1);
  const trp = v.voyages.find(x => x.status === 'completed');
  assert.equal(trp.from, 'dubai'); assert.equal(trp.to, 'fujairah');
  assert.equal(trp.departed, T0 + H); assert.equal(trp.arrived, T0 + 5.5 * H);
  assert.equal(trp.durationH, 4.5);
  assert.ok(trp.distanceKmEst >= 105 && trp.distanceKmEst <= 160, String(trp.distanceKmEst));
  assert.ok(trp.track.length >= 2);
  assert.equal(v.now.state, 'in_port'); assert.equal(v.now.port, 'fujairah');
  assert.equal(v.calls.length, 2);
});

test('feeding the same snapshot again changes nothing', () => {
  const st = newStore();
  const first = run(st, trip());
  const again = run(st, trip());
  assert.ok(first.events.length > 0);
  assert.deepEqual(again, { events: [], positions: [] });
});

test('duplicate log lines (a crashed run) do not create duplicate voyages', () => {
  const st = newStore();
  const log = run(st, trip());
  const doubled = { events: [...log.events, ...log.events], positions: [...log.positions, ...log.positions] };
  assert.equal(build(st, doubled, T0 + 7 * H).meta.completed, 1);
});

test('GPS flapping at the port edge is one stay, not two voyages', () => {
  const st = newStore();
  const at = (t, port) => snap([ship({ lat: 25.27, lon: 55.28, ts: T0 + t, port, arrived: port ? T0 + t : null, last: 'dubai', left: port ? null : T0 + t })], T0 + t);
  const out = build(st, run(st, [at(0, 'dubai'), at(0.2 * H, null), at(0.4 * H, 'dubai')]), T0 + H);
  const v = A(out);
  assert.equal(v.voyages.filter(x => x.status === 'completed').length, 0);
  assert.equal(v.now.state, 'in_port');
  assert.equal(v.calls.length, 1);
});

test('moving straight from one port zone to another is flagged approximate', () => {
  const st = newStore();
  const log = run(st, [
    snap([ship({ ts: T0, port: 'dubai', arrived: T0, last: 'dubai' })], T0),
    snap([ship({ ts: T0 + 2 * H, port: 'fujairah', arrived: T0 + 2 * H, last: 'fujairah' })], T0 + 2 * H),
  ]);
  const trp = A(build(st, log, T0 + 3 * H)).voyages.find(x => x.status === 'completed');
  assert.equal(trp.note, 'approx');
  assert.equal(trp.durationH, undefined);
});

test('first heard at sea but the collector remembers the last port: origin known, flagged inferred', () => {
  const st = newStore();
  const log = run(st, [snap([ship({ lat: 25.2, lon: 55.7, sog: 10, ts: T0 + 2 * H, last: 'dubai', left: T0 + H })], T0 + 2 * H)]);
  const leg = A(build(st, log, T0 + 2 * H)).voyages[0];
  assert.equal(leg.status, 'in_progress'); assert.equal(leg.from, 'dubai'); assert.equal(leg.note, 'inferred');
});

test('first heard at sea with no history: origin stays unknown and nothing is invented', () => {
  const st = newStore();
  const log = run(st, [snap([ship({ lat: 25.5, lon: 56.5, sog: 9, ts: T0, dest: 'FUJAIRAH' })], T0)]);
  const out = build(st, log, T0 + H);
  const leg = A(out).voyages[0];
  assert.equal(leg.status, 'in_progress'); assert.equal(leg.from, null); assert.equal(leg.fromKnown, false);
  assert.equal(leg.destPort, 'fujairah');
  assert.ok(leg.remainingKmEst > 0);
  assert.equal(out.meta.completed, 0);
});

test('heard at sea, later reaches a port: completed voyage with unknown origin', () => {
  const st = newStore();
  const log = run(st, [
    snap([ship({ lat: 25.5, lon: 56.0, ts: T0, sog: 9 })], T0),
    snap([ship({ lat: 25.17, lon: 56.37, ts: T0 + 3 * H, port: 'fujairah', arrived: T0 + 2.5 * H, last: 'fujairah' })], T0 + 3 * H),
  ]);
  const trp = A(build(st, log, T0 + 4 * H)).voyages.find(x => x.status === 'completed');
  assert.equal(trp.from, null); assert.equal(trp.fromKnown, false); assert.equal(trp.to, 'fujairah');
});

test('saved positions are thinned: parked ship saves one, moving ship saves each leg', () => {
  const parked = newStore(), moving = newStore();
  const mk = (i, lat) => snap([ship({ lat, lon: 55, ts: T0 + i * 20 * 60e3 })], T0 + i * 20 * 60e3);
  const a = run(parked, Array.from({ length: 9 }, (_, i) => mk(i, 25)));
  const b = run(moving, Array.from({ length: 9 }, (_, i) => mk(i, 25 + i * 0.05)));
  assert.equal(a.positions.length, 1);
  assert.equal(b.positions.length, 9);
});

test('old trail points in a first snapshot are saved once, in time order', () => {
  const st = newStore();
  const log = run(st, [snap([ship({ lat: 25.3, lon: 55, ts: T0 + 3 * H, track: [[25.2, 55, T0 + H], [25.1, 55, T0]] })], T0 + 3 * H)]);
  assert.deepEqual(log.positions.map(p => p[1]), [T0, T0 + H, T0 + 3 * H]);
});

test('real data file: counts match, nothing invented', { skip: !fs.existsSync(path.join(HERE, 'data/ships.json')) }, () => {
  const real = JSON.parse(fs.readFileSync(path.join(HERE, 'data/ships.json'), 'utf8'));
  const st = newStore();
  const log = run(st, [real]);
  const now = Date.parse(real.meta.updated) || Date.now();
  const out = buildVoyages({ vessels: st.vessels, ...log, ports: st.ports, now });
  const real_mmsi = new Set(real.ships.map(s => String(s.mmsi)));
  assert.equal(out.vessels.length, real.ships.length);
  assert.ok(out.vessels.every(v => real_mmsi.has(v.mmsi)));
  assert.ok(out.vessels.every(v => ['in_port', 'at_sea'].includes(v.now.state)));
  assert.ok(out.vessels.every(v => v.voyages.filter(x => x.status === 'completed').every(x => x.to && x.arrived)));
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

// ---- the command-line recorder, run for real against temporary folders ----
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'me-'));
const cli = (cwd, env, ...args) => spawnSync(process.execPath, [path.join(HERE, 'history.mjs'), ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });

test('recorder: writes the log, is safe to run twice, leaves no temp files', () => {
  const d = tmp(), s = path.join(d, 'ships.json'), env = { SNAPSHOT: s, HISTORY_DIR: path.join(d, 'h'), VOYAGES_OUT: path.join(d, 'v.json') };
  const snaps = trip();
  for (const sn of snaps) {
    fs.writeFileSync(s, JSON.stringify(sn));
    assert.equal(cli(d, env).status, 0);
  }
  const count = () => fs.readdirSync(env.HISTORY_DIR).filter(f => f.endsWith('.ndjson')).map(f => fs.readFileSync(path.join(env.HISTORY_DIR, f), 'utf8')).join('').split('\n').length;
  const before = [count(), fs.readFileSync(env.VOYAGES_OUT, 'utf8')];
  assert.equal(cli(d, env).status, 0);   // same snapshot again
  assert.deepEqual([count(), fs.readFileSync(env.VOYAGES_OUT, 'utf8')], before);
  assert.equal(JSON.parse(before[1]).meta.completed, 1);
  assert.ok(!fs.readdirSync(env.HISTORY_DIR).some(f => f.endsWith('.tmp')));
});

test('recorder: a broken snapshot is refused and nothing is written', () => {
  const d = tmp(), s = path.join(d, 'ships.json'), env = { SNAPSHOT: s, HISTORY_DIR: path.join(d, 'h'), VOYAGES_OUT: path.join(d, 'v.json') };
  fs.writeFileSync(s, '{ not json');
  const r = cli(d, env);
  assert.equal(r.status, 1);
  assert.ok(!fs.existsSync(env.HISTORY_DIR) && !fs.existsSync(env.VOYAGES_OUT));
});

test('recorder: --backfill-git rebuilds history from earlier data updates', () => {
  const d = tmp(), g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8' });
  g('init', '-q'); fs.mkdirSync(path.join(d, 'data'));
  for (const sn of trip()) { fs.writeFileSync(path.join(d, 'data/ships.json'), JSON.stringify(sn)); g('add', '.'); g('commit', '-q', '-m', 'data update'); }
  const r = cli(d, {}, '--backfill-git');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'data/voyages.json'), 'utf8')).meta.completed, 1);
  assert.notEqual(cli(d, {}, '--backfill-git').status, 0);   // refuses to run on a history that already has data
});
