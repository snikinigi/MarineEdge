# MarineEdge — Plan (Task 4)

*Draft of 19 Oct 2026 · For owner approval · No code has been written · Nothing in Tasks 5 onwards starts until the owner approves this plan.*

## 1. What this plan covers

The internal vessel due-diligence tool from `docs/BRIEF.md`, built under the decisions in `docs/TASKS.md`:

- **Free data only.** No paid AIS history. A report covers the period we have recorded ("Recorded since [date]"). The record started on 16 Oct 2026 and grows every day.
- **Listening area** stays between Oman, Iran and the UAE.
- **Every vessel is keyed on its IMO number**, never on its name or MMSI.
- **Every threshold lives in `config/rules.yaml`.** Secrets live only in `.env` or GitHub Actions secrets.
- **Unknown stays unknown.** Anything we did not record shows as "not recorded".
- The sample report (`docs/Sample_Vessel_Voyage_Report.pdf`) is the layout target for the PDF.

## 2. How the data flows

Seven steps. No step costs money.

1. **Record.** A worker listens to AISStream and saves every position and every ship-details message (name, MMSI, draught, size).
2. **Store.** Everything goes into our own PostgreSQL + PostGIS database.
3. **Clean.** Drop exact duplicates and impossible fixes (bad coordinates). Do **not** drop fast jumps: those are a red flag (Task 14), not noise.
4. **Port calls.** Speed under 0.5 knots for 6 hours or more, within 5 nm of a World Port Index port or inside an anchorage zone. Anchorage waiting is part of the port call it precedes.
5. **Voyages.** One voyage runs from one port call to the next.
6. **Red flags.** One module per rule, each storing its evidence. Sanctions lists and sensitive zones come from free files.
7. **Screens and PDF.** Map, voyage list, voyage detail, PDF report.

Steps 3 to 6 are **rebuildable**: they are calculated from stored positions and `config/`. Change a threshold, re-run, and the results are redone. Only step 1 cannot be redone, which is why recording must start early (see decision 1).

## 3. Today's code: keep and replace

| Today | Plan | Why |
|---|---|---|
| React + MapLibre UI (map, ship list, ship sheet) in `src/` | **Keep** as the starting point; copy it into the new frontend | Task 5 says to reuse the UI shell |
| OpenFreeMap base map in the app | **Keep** for the interactive map | Free |
| `collect.mjs`, `history.mjs`, the three workflows | **Keep running, unchanged**, until cutover | They feed the public live map |
| `voyages.mjs` and its 17 tests | **Keep as reference**; port the logic and test cases to Python | Pure functions with good tests: a ready specification |
| Vessels keyed on MMSI | **Replace** with IMO keying; MMSI, name and flag become history per IMO | Brief rule; names and MMSI change |
| 19 rough port circles inside `collect.mjs` | **Replace** with World Port Index ports and anchorage zones (Task 9) | Brief rule: 5 nm of a WPI port |
| 72-hour window in `ships.json`; 90-day cut-off in `voyages.json` | **Replace**: the database keeps everything recorded | A report needs the whole recorded period |
| History saved as thinned snapshots in Git (about 417 positions for 89 ships in 2 days; no draught history) | **Replace** with raw positions in PostGIS; import the Git history once as low-detail data | Thin data cannot show the 0.5-knot rule, jumps or ship-to-ship meetings |
| Arrival and departure = "first heard inside or outside a circle" | **Replace** with the speed and time rule | Brief rule |

**Why the recorder changes.** Today `collect.mjs` listens for 7 minutes in every 20 (about a third of the time), merges what it hears into `ships.json`, and the history job thins that to one position per ship per 3 km or 3 hours. That is enough for a live map but not for the rules in the brief. The new worker listens continuously and keeps the data.

## 4. Folder structure

```
MarineEdge/
├─ .github/workflows/        collect, history, deploy (unchanged until cutover) + backend-tests (new)
├─ src/ index.html ...       today's app and data scripts: the public live map, unchanged until cutover
├─ collect.mjs history.mjs voyages.mjs voyages.test.mjs
├─ data/                     today's collected files (public map only)
├─ config/
│  ├─ rules.yaml             every threshold
│  ├─ zones.geojson          sensitive zones, GPS-jamming areas, anchorage zones, shipyard areas
│  └─ places.yaml            named straits, capes and islands (Task 23)
├─ backend/                  FastAPI (Python)
│  ├─ app/
│  │  ├─ api/                routes
│  │  ├─ providers/          adapter interface, MockProvider, AISStream provider (Task 7)
│  │  ├─ ingest/             recorder worker, one-off import of today's Git history
│  │  ├─ domain/             clean, port_calls, voyages, places, coverage, report_summary
│  │  ├─ rules/              one module per red-flag rule + the flag framework
│  │  ├─ reports/            report page and PDF export (Playwright)
│  │  ├─ db/                 models and migrations
│  │  └─ cli.py              rebuild, import, refresh sanctions lists
│  └─ tests/                 unit tests; fixtures/ holds synthetic tracks and the sample-report fixture
├─ frontend/                 React + TypeScript + MapLibre (UI shell copied from src/)
├─ docker-compose.yml        PostgreSQL + PostGIS, backend, frontend
├─ .env.example              names of the secrets, never the values
└─ docs/                     BRIEF.md, TASKS.md, PLAN.md, SOURCES.md (Task 6), sample report
```

Reports, notes, flags and any database dump are **never committed**. `.gitignore` covers `.env`, `reports/` and dumps.

## 5. Database

PostgreSQL + PostGIS. All times are UTC. Distances in nautical miles, speeds in knots.

**Recorded data**

- **vessels**: `imo` (primary key, 7 digits, check digit validated), `first_recorded`, `last_recorded`, ship type code, length, beam.
- **static_observations**: one row each time a ship's own details change: `imo`, `mmsi`, name, call sign, draught, destination, ETA, time. This is the source for draught over time ("draught as last reported") and for identity history.
- **identity_history**: derived. A new row whenever name, flag or MMSI changes: `imo`, name, flag, `mmsi`, `first_seen`, `last_seen`. The flag is read from the first three digits of the MMSI, as `collect.mjs` does today, so it is an indicator.
- **positions**: `imo`, `mmsi`, time, point (PostGIS), speed, course, heading, navigation status, source. One row per ship per time; partitioned by month; indexed on point and on (`imo`, time).
- **unmatched_positions**: positions heard before we know a ship's IMO. They are attached once the IMO is heard. Ships that never broadcast an IMO get no vessel record and no report.

**Reference data**

- **ports**: World Port Index ports: id, name, country, point.
- **zones**: kind (`sensitive`, `jamming`, `anchorage`, `shipyard`, `port_limit`), name, polygon, source. Loaded from `config/zones.geojson`.
- **places**: named places for "22 nm SW of Kerch Strait" (Task 23).
- **sanctions_entries**: list (OFAC, EU, UK), `imo`, name, listed date, removed date, source file, fetched date.
- **coverage_cells**: a coarse grid of where we regularly hear ships (Task 25).

**Calculated data (rebuildable)**

- **port_calls**: `imo`, port or anchorage zone, arrived, departed, whether arrival and departure were really seen, waiting time at anchorage, draught on arrival and departure.
- **voyages**: `imo`, from-call, to-call, departed, arrived, status (`completed` or `underway`), simplified track line, distance, draught out and in, hours dark. A voyage that starts before our record says "origin not recorded".
- **flags**: `imo`, voyage, rule, severity, start, end, point, evidence (the rule that fired, the numbers, the positions before and after), rule version. One flag per (`imo`, rule, start).

**Owner data**

- **notes**: `imo`, voyage or flag, text, time (the "Add note" button).
- **reports**: report number (`VVR-YYYY-NNNN`), `imo`, generated time, period shown.

## 6. API (MVP)

| Endpoint | What it does |
|---|---|
| `GET /health` | Health check |
| `GET /vessels/search?q=` | Name, IMO or MMSI; returns candidates (name, IMO, flag, type, size, recorded since). Only recorded ships. |
| `GET /vessels/{imo}` | Identity, current status, recorded period, coverage note |
| `GET /vessels/{imo}/identity-history` | Name, flag and MMSI changes with dates |
| `GET /vessels/{imo}/voyages` | Voyage list, newest first, colour index, flag count |
| `GET /vessels/{imo}/voyages/{id}` | Voyage facts, port calls, track, flags |
| `GET /vessels/{imo}/track` | GeoJSON for the main map: voyages, dashed current voyage, gap segments, flag markers, port dots |
| `GET /vessels/{imo}/flags` | All flags with evidence |
| `GET` and `POST /vessels/{imo}/notes` | Read and add notes |
| `GET /vessels/{imo}/report` | The report as a web page |
| `POST /vessels/{imo}/report` | Make the PDF; returns the report number and the file |

Things that change data are **not** web endpoints. They are commands run on the server: `rebuild --imo`, `rebuild --all`, `import-git-history`, `refresh-sanctions`. That keeps the public attack surface small.

## 7. Config files

`config/rules.yaml` holds, with the brief's starting values:

- **port_call:** max speed 0.5 kn, minimum 6 h, radius 5 nm.
- **ais_gap:** 6 h at sea; High above 24 h or within 100 nm of a sensitive zone.
- **draught_change:** 1.0 m.
- **ship_to_ship:** 500 m, both under 1 kn, 2 h or more, outside port limits.
- **position_jump:** 30 kn.
- **identity_change:** Medium if more than one change.
- **sanctions:** how far back list history is checked.
- **places:** distance beyond which we say "open sea" (Task 23).
- **coverage:** grid size and the number of ships heard that makes a cell "covered" (Task 25).

"Stop at sea" and "shipyard stay" thresholds are added only if the owner decides to build those event types.

## 8. How the public site keeps running

- **Until cutover nothing about the public site changes.** `collect`, `history` and `deploy` keep running; `src/`, `data/` and the root `package.json` are not touched. The Pages build only compiles the root app, so new folders (`backend/`, `frontend/`, `config/`, `docs/`) cannot break it.
- **Every task's "done" check includes:** the deploy still goes green and the site still loads.
- **The UI shell is copied, not moved,** into `frontend/` until cutover. This is a change to Task 5, which says "move". It means a short stretch of duplicate files in return for a public site that cannot break.
- **Nothing private goes into the public repo or site:** no flags, notes, reports, database dumps or `.env`.
- **At cutover** (after Task 21) the owner chooses between retiring the public live map or keeping it with only the current Pages content. If it is retired, the old root app, its two data workflows and the deploy workflow are removed in one commit.

## 9. How the tasks fit this plan

| Plan part | Tasks |
|---|---|
| Scaffold, database, health check | 5 |
| Free sources and licences | 6 |
| Adapter, recorder, storing positions | 7 |
| Search and IMO keying | 8 |
| Ports, zones, config | 9, then 22 and 23 |
| Port calls and voyages | 10 |
| Map screen | 11 |
| Flag framework and the seven rules | 12, 13, then 25 before 14, 14, 15, 16 |
| Report numbers and summary text | 24 |
| Voyage detail screen | 17 |
| PDF report | 18 |
| Review, real-vessel tests, hosting | 19, 20, 21 |

**Proposed changes to the task list if this plan is approved:** Task 5 copies the UI shell instead of moving it; Task 7 includes the continuous recorder and the one-off import of the Git history.

**Report map.** The interactive map keeps the free OpenFreeMap style. The PDF map is drawn from Natural Earth shapes bundled in the repo, so reports render without any outside map service.

## 10. Limits to know about

- **Coverage.** The free feed comes from volunteer receivers on land. Far offshore we may hear nothing, so a gap in our record is not always a ship switching off. Task 25 handles this; every report prints a coverage line.
- **Recorded period.** Early reports are short. Ships we have never heard cannot be reported on.
- **Draught** is typed in by the crew and arrives only when a ship sends its details. Flags that use it are indicators, not proof.
- **Old history is thin.** The first 3 days (from Git) have no speed or draught history for most ships, so they are imported flagged "low detail" and are not used for the 0.5-knot rule.
- **Licence of AISStream** for storing and showing the data is not yet checked (Task 6). One key may also be limited to one listener at a time; Task 6 checks that too.
- **No-IMO ships.** A few ships do not broadcast an IMO (1 of 89 today). They are left out of reports, by design.

## 11. Decisions for the owner

1. **Where does the recorder run, and from when?** Recording is the product: every day without a continuous recorder is a day missing from every future report. Options: (a) keep GitHub Actions only (free, but only about a third of the time and thin data); (b) a small always-on server (a small monthly cost); (c) a computer of yours that stays on. **Recommended:** decide before Task 7, not at Task 21. Until then Actions keeps recording as a backup either way. **Answered 19 Oct 2026:** the owner will provide a free always-on server for the recorder.
2. **Copy the UI shell instead of moving it** (section 8). **Recommended: copy.** **Accepted 19 Oct 2026.**
3. **After cutover, keep or retire the public live map?** Can wait until Task 21.
4. **How much detail to store.** **Recommended:** at most one position per ship per 5 minutes while moving and one per 30 minutes while stopped (speed under 0.5 kn), always keeping speed, course and navigation status, plus every change in draught or identity. **Accepted 19 Oct 2026.**
5. **Login for the internal tool.** Local only until Task 21 chooses the host. Then a simple shared login or a private network. **Accepted 19 Oct 2026.**

## 12. Done when

The owner approves this plan. If rejected, correct it and ask again.
