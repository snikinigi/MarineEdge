# MarineEdge — Task List

*Updated 19 Oct 2026 · Do one task at a time, in order. Nothing starts until the owner approves it.*

## Start here

Give the AI tool this document and the repo (or the latest zip), then paste:

> Read this whole document first. Do only Task N, exactly as written. Follow the Working rules. When it is done, stop, list the files you changed, and wait for my approval. Do not start any other task.

**Working rules**

- One task at a time. The owner approves or rejects each task before work starts; everything else stays on hold.

- Touch only the files a task lists. If something else looks wrong, report it instead of fixing it.

- Never put API keys or secrets in the repo, in a prompt or in this document. Keys live only in GitHub Actions secrets or an uncommitted .env file.

- Key every vessel on its IMO number, never on its name. (Today’s code keys on MMSI; Task 8 changes that.)

- Every threshold lives in one file, config/rules.yaml, so the owner can tune it without a code change.

- Every rule and every voyage function gets unit tests. Run node --test (current code) or the project’s test command before handing back.

- Use only real broadcasts. If something is not known, show it as unknown; never guess.

- Free data sources only. No paid data, no paid trials, no keys bought. Check each source's licence before using it (Task 6).

- After each task: tests pass, the owner reads the diff, the work is committed.

**Privacy note.** The brief asks for an internal tool, but the GitHub Pages site is public to anyone with the link. Until Task 21 settles hosting, keep due-diligence notes, flags and any paid-provider data out of the public repo and site, and check each provider’s licence before showing its data publicly.

**Status board** (edit as you go)

- Task 1 — Fix the white screen: done and confirmed by the owner (the live site loads)

- Task 2 — Tidy leftovers: done and confirmed by the owner

- Task 3 — Save the brief and the project rules: the three files are in the latest zip; owner to confirm they are committed to main

- Tasks 4–21: on hold

- Tasks 22, 23, 24 (added 19 Oct 2026): written, on hold

- Task 25 (coverage map): approved by the owner on 19 Oct 2026; it starts only when its turn comes, before Task 14

- Order of work: 1–9, 22, 23, 10–13, 25, 14–16, 24, 17–21. The tasks appear in this order below; the numbers stay as they are so older references still work.

## The project

**Today.** MarineEdge is a live map of cargo ships and tankers around the Strait of Hormuz, Persian Gulf and Gulf of Oman, hosted on GitHub Pages at https://snikinigi.github.io/MarineEdge/. It is not yet the due-diligence tool in the brief.

**Goal (from the brief).** An internal tool: type a vessel name, IMO or MMSI and see every voyage of that ship over the last 12 months on a map, port to port, with suspicious behaviour flagged and a one-click PDF report. It is used for vessel due diligence before fixing a ship or accepting a cargo (grains, oilseeds, vegetable oils, dry bulk). Out of scope for now: fleet-wide alerts, our own AIS receivers, a mobile app and selling the tool; build it so a later product version is not blocked.

**Decisions since the brief (19 Oct 2026).** Free data sources only, so there is no paid 12-month history: a report covers the period we have recorded (it started on 16 Oct 2026 and grows daily) and its header says "Recorded since [date]". The listening area stays between Oman, Iran and the UAE. Only ships we have recorded can have a report. The free live feed comes from receivers on land, so some stretches of sea have no coverage (Task 25). The sample report (docs/Sample_Vessel_Voyage_Report.pdf, fictional ship and invented data) is the layout target only. Equasis is not used. Global Fishing Watch: no permission requested, internal use only. Anchorage waiting merges into the port call it precedes, as in the brief.

**How the current code works** (checked by reading the latest zip)

- React + TypeScript + Vite + MapLibre front end in src/: a map, a ship list and a ship sheet. It loads data/ships.json and also bundles that file as a fallback.

- collect.mjs (GitHub Action collect) listens to AISStream for about 7 minutes every 20 minutes and saves data/ships.json: cargo ships and tankers only, last 72 hours, 27 ships in the latest file, inside a box around Oman, the UAE and Iran’s Hormuz coast.

- history.mjs and voyages.mjs (GitHub Action history) keep a permanent log in data/history/ and build data/voyages.json. All 17 unit tests pass. The app never reads voyages.json.

- .github/workflows/deploy.yml builds the app and publishes it to GitHub Pages on each push to main and after each collection. vite.config.ts now has base: './'.

- Not verified: I could not run the Vite build here (no network), so the first real build on GitHub is the test.

**Rules from the brief** (short form)

1.  Hide the AIS provider behind one adapter interface so it can be swapped without touching the rest of the app.

2.  Keep every position we record in our own database; never fetch the same history twice. (Free data only: nothing is paid for.)

3.  Confirm each source's licence allows storing the data and showing it in our tool. (Free sources only; see Task 6.)

4.  Do not scrape the MarineTraffic or VesselFinder websites.

5.  Draught is typed in by the crew, so draught flags are indicators, not proof.

6.  Port call: speed under 0.5 knots for at least 6 hours, within 5 nm of a World Port Index port or inside an anchorage zone. Anchorage waiting time belongs to the port call it precedes.

## Part A: Fix and tidy

### Task 1: Fix the white screen

**Goal:** the GitHub Pages address shows the app instead of a blank page.

**Cause:** GitHub Pages was serving the unbuilt index.html, which points at /src/main.tsx, and browsers cannot run that file. The repo had no Pages build workflow and no base path.

**Files:** vite.config.ts (only change: base: './') and .github/workflows/deploy.yml. Both are already in the latest zip.

**Owner steps:**

1.  In the repo go to Settings → Pages → Source and choose GitHub Actions.

2.  Commit both files to main.

3.  In the Actions tab, wait for “deploy” to turn green (about 2 minutes), then reload the site.

**Done when:** the map and ship list load at https://snikinigi.github.io/MarineEdge/.

**If the run goes red:** send the AI tool the error line from the Actions log. Type errors show as a warning only and do not block the deploy.

### Task 2: Tidy leftovers

**Goal:** remove dead and duplicate files so later tasks and other AI tools are not confused.

**Do:**

- Delete public/data/ships.json. It is a stale copy (17 ships; the live data/ships.json has more). The deploy workflow already replaces it at build time.

- Delete the stray root history.yml. The live workflow is .github/workflows/history.yml; the two differ only by two comment lines, so copy those two lines into the workflow first.

- Delete metadata.json (a Google AI Studio file).

- Delete sw.js and the root copies manifest.webmanifest, icon-180.png, icon-192.png, icon-512.png.

- Replace the README with a short, accurate one: what the app is, how data is collected, how it deploys.

**Checked:** nothing registers sw.js, and the root manifest and icons are byte-identical to the files in public/.

**Done when:** the deploy still goes green, the site still loads, and node --test still passes 17 of 17.

### Task 3: Save the brief and the project rules

**Goal:** every AI tool reads the same rules first.

**Do:** save the text of the brief as docs/BRIEF.md and this document as docs/TASKS.md. Create CLAUDE.md (other tools can read it too) with these lines from Step 0 of the brief:

- Read docs/BRIEF.md before any task.

- Vessels are keyed on IMO number, never on name.

- All thresholds live in config/rules.yaml.

- API keys only in .env; never commit .env.

- Every rule and every voyage function gets unit tests.

**Files:** new docs/BRIEF.md, docs/TASKS.md, CLAUDE.md. No code changes.

**Done when:** the three files are committed.

### Task 4: Plan before code

**Goal:** a written plan the owner approves before any rebuild.

**Do:** read docs/BRIEF.md and write docs/PLAN.md with the folder structure, the database schema (vessels, identity history, positions, port calls, voyages, flags) and the API endpoints for the MVP. Say what to keep from today’s code (the UI shell, and the voyages.mjs logic and tests as reference) and what to replace (MMSI keying, the 19 rough port circles, the 72-hour window). Plan for the recorded period, not 12 months, and for free data sources only. Say how the public site keeps running until the new version replaces it. Do not write code.

**Done when:** the owner approves the plan. If rejected, correct it and ask again.

## Part B: Milestone 1, Foundations (brief steps 0–4)

**Demo for the owner:** search a vessel by name or IMO, pick the right ship, and see that positions are cached.

### Task 5: Scaffold the project

**Goal:** a runnable project from the approved plan.

**Do:** a FastAPI backend; a React + TypeScript frontend with MapLibre (move today’s UI shell in rather than starting over); docker-compose with PostgreSQL + PostGIS; a health-check endpoint; a README with run instructions.

**Done when:** one command starts everything, the health check answers, and the existing app still builds.

### Task 6: Confirm free sources and licences

**Goal:** know exactly which free sources we use and what each licence allows, before any code depends on them.

**Do:** write docs/SOURCES.md with one row per source (AISStream, the sanctions lists, the World Port Index, Natural Earth, and any other free source): what it gives, that it is free, and what its licence allows, with a short quote and the link. Check that storing the data and showing it in our tool is allowed. No keys are bought and no trials are started. Do not scrape websites. Record the owner's decisions: Equasis not used; Global Fishing Watch: no permission requested, internal use only, attribution shown if it is ever used.

**Findings so far** (19 Oct 2026; check each vendor page before relying on it):

- AISStream: free, live only, no history; coverage follows volunteer receivers on land. Its licence on storing and showing the data has not been read yet.

- Global Fishing Watch: free for non-commercial and research use, attribution required; gives events, not raw positions. Internal business use may still count as commercial under its terms.

- Equasis: free with registration; its notices forbid robots and storing its data without written permission. Not used.

- OFAC, EU and UK sanctions lists, World Port Index, Natural Earth: free official downloads.

**Done when:** the owner has marked each source "use" or "do not use", and every "use" source has a licence line in docs/SOURCES.md.

### Task 7: Data provider adapter

**Goal:** swap the data source without touching the rest of the app.

**Do:** an interface with search_vessel(query), get_track(imo, start, end) and get_vessels_near(lat, lon, radius, start, end). A MockProvider that reads sample tracks from tests/fixtures. The real provider is AISStream (key in .env) plus our own stored positions. Keep every recorded position in PostGIS.

**Done when:** a test proves that a report is built from stored positions and makes no network call.

### Task 8: Vessel search and IMO keying

**Do:** add GET /vessels/search?q= that accepts a name, IMO or MMSI and returns candidates with name, IMO, flag, type and size. Search finds only ships we have recorded; for any other it says "not recorded by us yet". The UI lets the owner pick one ship, because names can match several. Re-key vessels on IMO and store name, flag and MMSI history per IMO.

**Done when:** the owner can search, pick a ship and see its history, and tests cover a name clash and a renamed ship.

## Part C: Milestone 2, Voyage map (brief steps 5–6)

**Demo for the owner:** the recorded period of a real vessel shows as separate coloured voyages with correct ports and dates.

### Task 9: Ports and the config file

**Do:** import the World Port Index (NGA) port coordinates into PostGIS. Create config/rules.yaml holding every threshold from the brief (the port-call numbers now, the red-flag numbers as each rule is built) and the anchorage zones.

**Done when:** ports load into the database and thresholds are read from the file, not hard-coded.

### Task 22: Vessel particulars (do after Task 9)

**Goal:** the report header shows what we really know about the ship and says "not recorded" for the rest.

**Do:**
- Show what AIS broadcasts and we already store: name, IMO, MMSI, flag, ship type, length and beam.
- Deadweight, year built and size class (for example Supramax) are not broadcast, and the owner has decided not to use Equasis or hand-typed figures. Show all three as "not recorded". Keep the fields in the report layout so a later source can fill them without a redesign.
- Flag, MMSI and name history: show "was X until [date]" only when our own records saw the change. Never fill in earlier history.

**Files:** a new particulars module and its tests. No config file.

**Done when:** a ship shows the broadcast fields, the three missing fields read "not recorded", and tests cover that plus a flag or MMSI change that we recorded.

### Task 23: Places at sea (do after Task 9)

**Goal:** describe any position the way the sample does: "22 nm SW of the Kerch Strait".

**Do:**
- Write one function, describePosition(lat, lon), that returns the nearest named place, the distance in nautical miles and an eight-point compass direction.
- Names come from the World Port Index ports (Task 9) plus an owner-editable list, config/places.yaml, of straits, capes and islands.
- If the nearest place is farther than a limit kept in config/rules.yaml, say "open sea, X nm from [place]".
- Country wording ("off Russia") comes from the nearest place. How disputed areas are worded is the owner's decision.

**Files:** new places module, config/places.yaml, config/rules.yaml, tests.

**Done when:** tests pass for each of the eight directions, a short distance, a very long distance, and two places at nearly the same distance.

### Task 10: Port calls and voyage splitting

**Do:** detect port calls and split voyages exactly as in the brief: a voyage runs from one port call to the next. Today’s voyages.mjs is a reference only, because it uses MMSI and rough port circles. Write unit tests on synthetic tracks: a normal two-port voyage, a long anchorage wait, and a voyage with a gap. Anchorage waiting belongs to the port call it precedes: the port-call row says "waited at [anchorage] for N days" and gets no row of its own. An anchorage wait that is not followed by a port call stays as its own row. Add a test for each case.

**Done when:** all tests pass.

### Task 11: The map screen

**Do:** build the main screen from the brief’s first mock-up: search bar on top, map on the left, voyage list on the right, newest first. One colour per voyage. The current voyage is dashed and ends at the ship’s live position. Port calls are dots with names, AIS gaps are dotted red segments. Clicking a voyage in the list highlights it on the map and opens its detail. Today’s MapView.tsx is the starting point. The map caption shows "Recorded since [date]".

**Done when:** the owner can run the milestone demo above.

## Part D: Milestone 3, Red flags (brief steps 7–8)

**Demo for the owner:** all seven rules fire correctly on test tracks and on one known real case.

Every flag stores its evidence: the rule that fired, severity, start and end time, coordinates, and the positions before and after. Each rule is its own module with its own tests.

### Task 12: Flag framework, zones and sanctions lists

**Do:** build flag storage with evidence. Create config/zones.geojson with the sensitive zones (for example Crimea, occupied Ukrainian ports, Syria, Iran, North Korea), editable by the owner, plus the known GPS-jamming areas (Black Sea, Baltic, Eastern Mediterranean, Gulf). Load the OFAC SDN, EU and UK sanctions lists from the official downloads, refreshed daily, and match them on IMO.

### Task 13: Sanctions hit and call at a sensitive port

**Do:** Sanctions hit (High): the IMO is on an OFAC, EU or UK list now or was in the past 12 months. Call at a sensitive port (High): a port call or anchorage inside a listed zone.

### Task 25: Coverage map (approved 19 Oct 2026; do before Task 14)

**Goal:** tell "the ship switched AIS off" from "we had no receiver there".

**Do:** build a coarse grid from our own recorded positions that marks where we regularly hear ships. In Task 14, raise an AIS gap at the normal severity only when both ends of the gap are in a covered cell. Otherwise show it as "no coverage, not flagged". The report prints the coverage level for each gap (the sample's "in an area with good coverage"). Thresholds go in config/rules.yaml.

**Done when:** tests on synthetic tracks show a gap in a covered area flagged and the same gap in an uncovered area not flagged.

### Task 14: AIS gap and position jump

**Do:** AIS gap (Medium): no position for more than 6 hours at sea; raise to High if over 24 hours or within 100 nm of a sensitive zone. Position jump (Medium): implied speed between two fixes above 30 knots; label it “possible GPS jamming” inside the known jamming areas. Do not raise a gap as "AIS off" where Task 25 shows we had no coverage.

### Task 15: Draught change and identity change

**Do:** Draught change at sea (High): reported draught changes by 1.0 m or more with no port call in between; show it as an indicator, not proof. Identity change (Info, Medium if more than one): name, flag or MMSI changed in the period.

### Task 16: Possible ship-to-ship transfer

**Do:** High: another vessel within 500 m, both under 1 knot, for 2 hours or more, outside port limits. This needs the positions of other ships. With free data there is no per-call cost, but it only works where we hear both ships, so the owner decides, once Task 25 shows where we have coverage, whether it is in the MVP or moves to phase 2.

### Task 24: Report numbers and summary text (do after Task 16, before Task 17)

**Goal:** the numbers at the top of the report, the "time by country" table and the summary paragraph, all computed from our records.

**Do:**
- Compute: port calls, countries called at, days in port, at anchor or stopped, days sailing, number and total hours of AIS-off periods, and number of High and Medium flags.
- Time by country: anchorage waiting is part of the port call it precedes, so it counts for that port's country. Shipyard days count for the country; stops at sea do not (as in the sample).
- Report the recorded period and any unrecorded time separately, so the totals add up to the recorded period.
- Summary: fixed sentence templates filled from those numbers (route pattern, most serious flag, current status). No interpretive wording such as "consistent with loading at an undeclared location" unless the owner approves that exact sentence. Always include the sentence that cargo is not broadcast.
- Report ID in the form VVR-YYYY-NNNN and a generated time in UTC.
- Save the sample report as a test fixture (tests/fixtures) and check that our code gives its totals: 21 port calls, 6 countries, and the country table (Egypt 6 calls 81.8 days, Turkey 3 calls 53.3, Russia 5 calls 45.8, Romania 5 calls 38.6, Lebanon 1 call 9.6, Libya 1 call 9.6). Merging anchorage rows into port calls does not change these totals.

**Files:** new report-summary module, tests, tests/fixtures.

**Done when:** all tests pass, including the sample-fixture test.

### Task 17: Voyage detail and flag panel

**Do:** build the brief’s second mock-up. Voyage facts: departed, arrived, duration, draught out and in, time dark. Each flag shows its rule, severity, times and position, with a “Show on map” button that zooms the map to that spot and time window. Add note and Export PDF buttons.

**Done when:** the owner can run the milestone demo above.

## Part E: Milestone 4, Report and go-live (brief steps 9–10)

### Task 18: PDF report

**Do:** add an “Export report” button that produces a PDF with the vessel identity, the map, the voyage table and all flags with evidence, using Playwright to print the report page. The report header and map caption show "Recorded since [date]".

### Task 19: Full review

**Do:** review the whole codebase against docs/BRIEF.md. List anything missing or wrong, security issues (keys, input validation) and slow queries. Then fix them and run all tests.

### Task 20: Real-vessel tests

**Needs the owner:** 5–10 real vessels, including at least one known case with AIS gaps. Use ships we have already recorded; if no known AIS-gap case exists in our data yet, say so instead of forcing one.

**Done when:** every rule behaves correctly on them and the owner has seen the results.

### Task 21: Hosting and backups

**Do:** decide where the internal tool lives (the Pages site is public), deploy it there, and set up a daily database backup.

**Done when:** the tool runs on the server, a backup has been restored once as a test, and all tests pass.

## Decisions

**Made (19 Oct 2026)**

- Free data sources only; no paid 12-month history.

- Listening area stays between Oman, Iran and the UAE; collect.mjs does not change.

- Task 25 (coverage map) approved.

- Global Fishing Watch: no permission requested, because the tool is internal only. No task needs it yet.

- Equasis not used; deadweight, year built and size class show "not recorded".

- Anchorage waiting merges into the port call it precedes, as in the brief.

**Still open**

- Where the internal tool is hosted, since the Pages site is public (Task 21).

- Whether ship-to-ship detection is in the MVP or phase 2 (Task 16).

- Thresholds for "stop at sea" (sample: 46 h) and "shipyard stay" (sample: 29 days), and whether those two stop types are built at all.

- How disputed places are worded in reports (Task 23).
