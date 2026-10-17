// history.mjs: saves what collect.mjs heard into a permanent log and rebuilds data/voyages.json.
// It only READS data/ships.json; it never changes it and never touches the collector.
//
//   node history.mjs                 normal run (the workflow does this after each collect run)
//   node history.mjs --backfill-git  one-off: replay earlier data updates from git history
//
// Optional env: SNAPSHOT (data/ships.json), HISTORY_DIR (data/history), VOYAGES_OUT (data/voyages.json)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newStore, ingest, buildVoyages } from './voyages.mjs';

const SNAP = process.env.SNAPSHOT || 'data/ships.json';
const DIR = process.env.HISTORY_DIR || 'data/history';
const OUT = process.env.VOYAGES_OUT || 'data/voyages.json';
const STATE = path.join(DIR, 'state.json');
const fail = msg => { console.error(msg); process.exit(1); };

const writeAtomic = (file, text) => {   // write to a temp file first so a crash never leaves half a file
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', text);
  fs.renameSync(file + '.tmp', file);
};
const month = ts => new Date(ts).toISOString().slice(0, 7);

function append(kind, rows, tsOf) {   // monthly append-only files: events-2026-10.ndjson, pos-2026-10.ndjson
  const by = {};
  for (const r of rows) (by[month(tsOf(r))] ||= []).push(JSON.stringify(r));
  for (const [mo, lines] of Object.entries(by)) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(path.join(DIR, `${kind}-${mo}.ndjson`), lines.join('\n') + '\n');
  }
}

function readLog(kind) {
  const rows = []; let bad = 0;
  if (!fs.existsSync(DIR)) return { rows, bad };
  for (const f of fs.readdirSync(DIR).filter(f => f.startsWith(kind + '-') && f.endsWith('.ndjson')).sort())
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { bad++; }
    }
  return { rows, bad };
}

let store = newStore();
try { const s = JSON.parse(fs.readFileSync(STATE, 'utf8')); if (s.v === 1) store = s; } catch {}

const snaps = [];
if (process.argv.includes('--backfill-git')) {
  if (Object.keys(store.vessels).length) fail('History already has data. Backfill is only for an empty history.');
  let shas = [];
  try { shas = execFileSync('git', ['log', '--reverse', '--format=%H', '--', SNAP], { encoding: 'utf8' }).split('\n').filter(Boolean); }
  catch (e) { fail(`git log failed: ${e.message}`); }
  for (const sha of shas) {
    try { snaps.push(JSON.parse(execFileSync('git', ['show', `${sha}:${SNAP}`], { encoding: 'utf8', maxBuffer: 1 << 27 }))); } catch {}
  }
  if (!snaps.length) fail('No earlier data updates found in git history.');
} else {
  try { snaps.push(JSON.parse(fs.readFileSync(SNAP, 'utf8'))); }
  catch (e) { fail(`Cannot read ${SNAP}: ${e.message}`); }
}

const events = [], positions = [];
for (const s of snaps) { const r = ingest(store, s); events.push(...r.events); positions.push(...r.positions); }
append('events', events, e => e.ts);
append('pos', positions, p => p[1]);
store.updated = new Date().toISOString();
writeAtomic(STATE, JSON.stringify(store));

// "now" is the time of the newest snapshot, so running again without new data gives the same file.
const ref = Date.parse(snaps[snaps.length - 1]?.meta?.updated || '') || Date.now();
const E = readLog('events'), Q = readLog('pos');
const result = buildVoyages({ vessels: store.vessels, events: E.rows, positions: Q.rows, ports: store.ports, now: ref });
if (E.bad + Q.bad) result.meta.warnings = [`${E.bad + Q.bad} unreadable log lines were skipped`];
writeAtomic(OUT, JSON.stringify(result));

console.log(JSON.stringify({
  snapshots: snaps.length, newEvents: events.length, newPositions: positions.length,
  vessels: result.meta.vessels, inPort: result.meta.inPort, atSea: result.meta.atSea,
  completedVoyages: result.meta.completed,
}));
