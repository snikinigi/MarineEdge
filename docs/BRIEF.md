# Vessel Voyage Tracker — Developer Brief

Oct 13, 2026 · @Djam

## Purpose and scope

Build an internal web tool where I type a vessel name or IMO number and see every voyage that ship made over the last 12 months, drawn on a map: the current voyage, the one before it, and so on, with suspicious behaviour flagged. I will use it for vessel due diligence before fixing a ship or accepting a cargo (grains, oilseeds, vegetable oils, dry bulk).

**In scope for the first version (MVP):**

- Search by vessel name, IMO or MMSI
- 12 months of position history, split into voyages from port to port
- A map with one coloured line per voyage; the current voyage dashed and updating
- A voyage list and a voyage detail view (ports, dates, draught on departure and arrival)
- Red-flag detection: AIS gaps, draught change at sea, possible ship-to-ship transfers, position jumps, calls at sensitive ports, name/flag/MMSI changes, sanctions-list hits
- A one-click PDF vessel report

**Out of scope for now:** fleet-wide monitoring and alerts, our own AIS receivers, a mobile app, and selling the tool to third parties. Build it so that a later product version is not blocked.

## How it works

Every search runs the same eight steps, left to right on top and right to left below. Only step 3 costs money; everything after it runs on our own cached data.

**From a vessel name to a flagged voyage map in eight steps**

*Diagram (data flow · 8 steps, 2 outside sources), transcribed from the PDF image.*

Top row, left to right:

1. **Search** — Name, IMO or MMSI
2. **Identify ship** — Pick the IMO from matching ships
3. **Fetch track** — 12 months of AIS positions, cached
4. **Clean** — Drop duplicates and bad fixes

Step 4 leads down into the bottom row, which runs right to left:

5. **Port calls** — Slow 6 h+ near a port or anchorage
6. **Voyages** — Port to port, one line each
7. **Red flags** — Gaps, draught, STS, sanctions, ports
8. **Map and report** — Coloured voyages, flags, PDF export

Two outside data sources (dashed boxes): **AIS provider API** feeds step 3, and **Sanctions lists + sensitive zones** feed step 7.

## Data sources

The tool is only as good as its historical AIS data, so budget for one paid global AIS API from day one. Free feeds are fine for testing and for live top-ups only.

| Source | Coverage | History | Cost model | Role |
| --- | --- | --- | --- | --- |
| [Kpler / MarineTraffic API](https://www.marinetraffic.com/en/ais-api-services) | Global, coastal + satellite | Yes | Paid credits / contract | Primary candidate |
| [Kpler / Spire Maritime](https://kpler.com/blog/kpler-completes-acquisition-of-spire-maritime-strengthening-maritime-intelligence-capabilities) (Kpler bought Spire Maritime in April 2025) | Global, strong satellite | Yes | Paid contract | Primary candidate |
| [Datalastic](https://datalastic.com/) | Global | Yes | Paid monthly plans | Lower-cost option |
| [VesselFinder API](https://api.vesselfinder.com/) | Global | Limited | Paid credits | Alternative |
| [aisstream.io](https://aisstream.io/) | Coastal receivers only | Live only | Free | Testing, live top-up |
| [Global Fishing Watch API](https://globalfishingwatch.org/our-apis/) | Global, focus on fishing and carrier vessels | Events (port visits, gaps) | Free, non-commercial terms | Cross-check of gaps |
| [World Port Index (NGA)](https://msi.nga.mil/Publications/WPI) | Global port coordinates | n/a | Free | Port-call detection |
| OFAC SDN, EU and UK sanctions lists | Vessels listed by IMO | n/a | Free downloads | Sanctions screening |

**Rules for the developer:**

- Key every vessel on its **IMO number**. Names change on sale; MMSI changes with the flag. Keep a history of name, flag and MMSI per IMO.
- Hide the provider behind one adapter interface, so we can switch provider without touching the rest of the app.
- Cache every position we pay for in our own database; never pay twice for the same history.
- Confirm each provider's licence allows us to store the data and show it in our own tool.
- Get current pricing directly from the vendors.
- Do not scrape the MarineTraffic or VesselFinder websites. It breaks their terms of use and they block it.

## Screens

Two screens carry the MVP: the voyage map and the voyage detail. The vessel, dates and flags below are sample data to show the layout, not a real ship.

**Main screen: every voyage of the vessel on one map**

*Mock-up 1 · main screen, sample data. Transcribed from the PDF image.*

- Top bar: **Voyage Tracker**, a search box showing "MV SAMPLE BULKER · IMO 9000001", and an **Export PDF report** button.
- Summary line: Bulk carrier · Panama flag (Togo until March) · last 12 months · 5 voyages · 4 red flags
- Left, the map ("Map: Black Sea and Eastern Mediterranean"): the ports Constanța, Novorossiysk, Mersin and Alexandria, the Bosphorus, and the ship's current position ("Now"). Two red-flag markers: "AIS gap 38 h" (a dotted red segment inside the shaded "Sevastopol zone") and "Draught +4.1 m at sea".
- Right, "Voyages, newest first":
  - V5 · underway (dashed line): Constanța → Alexandria, left 2 Oct, no flags yet
  - V4: Mersin → Constanța, Aug to Sep, no flags
  - V3: Novorossiysk → Mersin, Jun to Jul, 1 flag
  - V2 · selected (highlighted): Alexandria → Novorossiysk, Apr to May, 2 flags
  - V1: Constanța → Alexandria, Feb to Mar, no flags

One colour per voyage, newest first in the list. The current voyage is dashed and ends at the ship's live position. AIS gaps are dotted red, sensitive zones are shaded red, and each red flag is a marker on the map. Clicking a voyage in the list highlights it on the map and opens its detail.

**Voyage detail: every red flag shows its evidence**

*Mock-up 2 · voyage detail and red flags, sample data. Transcribed from the PDF image.*

- Header: **V2 · Alexandria → Novorossiysk**, "MV SAMPLE BULKER · IMO 9000001 · sample data"
- Voyage facts: Departed: Alexandria, 14 Apr · Arrived: Novorossiysk, 29 May · Duration: 45 days · Draught out / in: 6.2 m / 6.4 m · Time dark: 38 hours. Buttons: **Show on map**, **Add note**, **Export PDF**.
- Red flags on this voyage (2):
  - **HIGH** — AIS gap of 38 hours. Off 11 May 21:40, back on 13 May 11:50. Last position 40 nm from Sevastopol. Button: Show on map →
  - **MEDIUM** — Position jump, 41 knots. Black Sea, 16 May 03:10. Inside a known GPS jamming area. Button: Show on map →

Every flag shows its rule, severity, times and position, with a button that zooms the map to that spot and time window. The same content goes into the PDF report.

## Voyage splitting and red-flag rules

A voyage runs from one port call to the next. Put every threshold below in one config file so I can tune them without a code change.

**Port call:** speed under 0.5 knots for at least 6 hours, within 5 nm of a World Port Index port or inside an anchorage zone. Anchorage waiting time belongs to the port call it precedes.

| Red flag | Rule (starting threshold) | Severity |
| --- | --- | --- |
| Sanctions hit | IMO on OFAC, EU or UK lists, now or in the past 12 months | High |
| Call at a sensitive port | Port call or anchorage inside a listed zone (e.g. Crimea, occupied Ukrainian ports, Syria, Iran, North Korea); zone list editable by me | High |
| AIS gap | No position for more than 6 hours at sea; raise to High if over 24 hours or within 100 nm of a sensitive zone | Medium / High |
| Draught change at sea | Reported draught changes by 1.0 m or more with no port call in between | High |
| Possible ship-to-ship transfer | Another vessel within 500 m, both under 1 knot, for 2 hours or more, outside port limits | High |
| Position jump | Implied speed between two fixes above 30 knots; label "possible GPS jamming" in known jamming areas (Black Sea, Baltic, Eastern Mediterranean, Gulf) | Medium |
| Identity change | Name, flag or MMSI changed in the period | Info (Medium if more than one) |

Each flag stores its evidence: start and end time, coordinates, the positions before and after, and the rule that fired. It shows on the map as a marker and in the flag list.

Draught is typed in by the crew, so draught-based flags are indicators, not proof. Ship-to-ship detection needs positions of other ships in an area, which costs more API calls; it can move to phase 2 if the provider makes it expensive.

## Tech stack

A standard, low-cost web stack is enough. These are suggestions; the developer may propose alternatives with a reason.

| Layer | Suggested choice | Why |
| --- | --- | --- |
| Frontend | React + TypeScript | Common, easy to hire for |
| Map | MapLibre GL JS (free) with a free or low-cost base map | Draws thousands of track points smoothly, no Mapbox fees |
| Backend API | Python + FastAPI | Strong geodata libraries (pandas, shapely) for voyage and flag logic |
| Database | PostgreSQL + PostGIS | Stores positions and does distance / zone queries natively |
| Background jobs | Scheduled worker (e.g. cron or a task queue) | Refreshes positions of vessels I am watching |
| PDF report | Headless browser (Playwright) printing the report page | Report looks exactly like the screen |
| Secrets | `.env` file, never committed | API keys stay private |
| Hosting | One small cloud server or container host | Enough for internal use |

## Building it with Claude Code, step by step

Build in small steps: one prompt per step, run the tests, review the diff, commit, then move on. The prompts below can be pasted into Claude Code as written. See the [Claude Code docs](https://docs.claude.com/en/docs/claude-code/overview) for setup.

### Step 0 — Set up

Install Claude Code, create an empty Git repository, and save this brief inside it as `docs/BRIEF.md`. Open a terminal in the folder, run `claude`, then run `/init` to create a `CLAUDE.md` file. Add these lines to `CLAUDE.md`:

```
- Read docs/BRIEF.md before any task.
- Vessels are keyed on IMO number, never on name.
- All thresholds live in config/rules.yaml.
- API keys only in .env; never commit .env.
- Every rule and every voyage function gets unit tests.
```

### Step 1 — Plan before code

Switch to plan mode (Shift+Tab) so Claude Code proposes a plan without touching files.

```
Read docs/BRIEF.md. Propose the folder structure, the database schema
(vessels, identity history, positions, port calls, voyages, flags) and
the API endpoints for the MVP. Do not write code yet.
```

Review and correct the plan, then approve it.

### Step 2 — Scaffold the project

```
Create the project from the approved plan: a FastAPI backend, a React +
TypeScript frontend with MapLibre, and docker-compose with PostgreSQL +
PostGIS. Add a health-check endpoint and a README with run instructions.
```

### Step 3 — Data provider adapter

```
Create an AIS provider interface with three methods: search_vessel(query),
get_track(imo, start, end), get_vessels_near(lat, lon, radius, start, end).
Implement a MockProvider that reads sample tracks from tests/fixtures, and
one real provider using the API key in .env. Cache every fetched position
in PostGIS and only fetch periods we do not already have.
```

### Step 4 — Vessel search

```
Add GET /vessels/search?q= that accepts a name, IMO or MMSI and returns
candidates with name, IMO, flag, type and size. Names can match several
ships, so the UI must let me pick one. Store name/flag/MMSI history per IMO.
```

### Step 5 — Port calls and voyages

```
Implement port-call detection and voyage splitting exactly as in the
"Voyage splitting and red-flag rules" section of the brief, with
thresholds from config/rules.yaml. Write unit tests on synthetic tracks:
a normal two-port voyage, a long anchorage wait, and a voyage with a gap.
Run the tests and fix failures.
```

### Step 6 — The map screen

```
Build the main screen shown in the brief's mock-up: search bar on top,
map on the left, voyage list on the right. One colour per voyage,
current voyage dashed, port calls as dots with names, AIS gaps as dotted
red segments. Clicking a voyage in the list highlights it on the map.
```

### Step 7 — Red-flag engine

```
Implement each red-flag rule from the brief as its own module with tests.
Each flag stores rule, severity, start/end time, coordinates and evidence
positions. Load sensitive zones from config/zones.geojson and sanctions
lists from the official OFAC, EU and UK downloads, refreshed daily.
```

### Step 8 — Voyage detail and flag panel

```
Build the voyage detail and red-flag panel shown in the brief's second
mock-up. Clicking a flag zooms the map to its location and time window.
```

### Step 9 — PDF report

```
Add an "Export report" button that produces a PDF with vessel identity,
the map, the voyage table and all flags with evidence, using Playwright
to print the report page.
```

### Step 10 — Review, test and deploy

```
Review the whole codebase against docs/BRIEF.md. List anything missing
or wrong, security issues (keys, input validation), and slow queries.
Then fix them and run all tests.
```

Test on 5–10 real vessels I will provide, including at least one known case with AIS gaps. Then deploy to the server and set up a daily database backup.

**Checkpoints after every step:** tests pass, the developer reads the diff, the work is committed to Git. Never paste API keys into a prompt.

## Milestones and acceptance

Please send a time estimate for each milestone; I will review a working demo at the end of each one.

| Milestone | Covers steps | Accepted when |
| --- | --- | --- |
| M1 Foundations | 0–4 | I can search a vessel by name or IMO and pick the right ship; positions are cached |
| M2 Voyage map | 5–6 | 12 months of a real vessel shows as separate coloured voyages with correct ports and dates |
| M3 Red flags | 7–8 | All seven rules fire correctly on test tracks and on one known real case |
| M4 Report and go-live | 9–10 | PDF report exports; tool runs on the server with backups; tests pass |

## Open questions for the developer

- Which AIS provider do you recommend after trialling two, and what is the monthly cost at the volume I will give you?
- Does that provider's licence allow us to store positions and show them in our own tool?
- Is ship-to-ship detection affordable in the MVP, or should it move to phase 2?
- Time estimate per milestone and total.
