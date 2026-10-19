# MarineEdge — Free Sources and Licences

*Task 6 · written 19 Oct 2026 · Checked against the vendors' own pages where I could reach them; what I could not read is listed at the bottom. Nothing here is legal advice. The owner's use / do-not-use decisions were recorded on 19 Oct 2026 in the last column.*

## Summary table

| # | Source | What it gives | Free? | What the licence says (short quote, link) | My recommendation | Owner decision |
|---|--------|---------------|-------|-------------------------------------------|-------------------|----------------|
| 1 | **AISStream** | Live AIS positions and ship-details messages over a WebSocket | Yes (free account key) | **No licence or terms of use published.** Docs page says the service "provides no SLA or uptime guarantee". https://aisstream.io/documentation | Conditional: use for the internal recorder only; ask for a written answer (Finding 1) | **Use** (owner, 19 Oct 2026). No written permission exists either way. |
| 2 | **OFAC SDN list** (US Treasury) | Sanctioned people, companies and vessels | Yes, no key | No licence page found. US government work: Treasury's Fiscal Service terms say "Government works generally cannot be copyrighted". https://sanctionslist.ofac.treas.gov/Home/static/sdn.html | Use | **Use** (owner, 19 Oct 2026) |
| 3 | **EU Financial Sanctions Files (FSF)** | EU asset-freeze list (people, companies) | Yes; free login needed to get the download link | Commission reuse rule is a "general open and permissive attribution licence": credit the source, do not distort it. https://webgate.ec.europa.eu/fsd/fsf/ and https://eur-lex.europa.eu/eli/dec/2011/833/oj | Use, but it does **not** contain vessels (Finding 3) | **Use** (owner, 19 Oct 2026) |
| 4 | **EU Official Journal sanctions annexes** (EUR-Lex) | The EU's vessel listings, e.g. Annex XLII of Regulation 833/2014 | Yes | EUR-Lex's legal notice says the legal documents on it may be reused for commercial or non-commercial purposes unless stated otherwise, under Decision 2011/833/EU. https://eur-lex.europa.eu/content/legal-notice/legal-notice.html | Needed for EU vessels | **Use** (owner, 19 Oct 2026) |
| 5 | **UK Sanctions List** (FCDO) | UK designations and "specified ships", with IMO numbers; CSV and XML | Yes, no key | "All content is available under the Open Government Licence v3.0" (page-level statement). https://www.gov.uk/government/publications/the-uk-sanctions-list | Use | **Use** (owner, 19 Oct 2026) |
| 6 | **World Port Index** (NGA Pub 150) | Port names and coordinates (CSV, JSON, shapefile) | Yes | Old 19th edition: "Approved for public release; distribution unlimited". NGA's own 2022 briefing on the current World Port Index is also marked "Approved for Public Release" and points to the download page. The download page itself was not opened. https://apps.dtic.mil/sti/pdfs/ADA510220.pdf · https://iho.int/uploads/user/Inter-Regional%20Coordination/WEND-WG/WENDWG12/WENDWG12_2022_05.2C_EN_NGA_World_Port_Index.pdf · https://msi.nga.mil/Publications/WPI | Use | **Use** (owner, 19 Oct 2026) |
| 7 | **Natural Earth** | Country borders, coastlines | Yes | "No permission is needed to use Natural Earth." Public domain. https://www.naturalearthdata.com/about/terms-of-use/ | Use | **Use** (owner, 19 Oct 2026) |
| 8 | **OpenFreeMap tiles / OpenStreetMap data** | The map background in today's app | Yes, no key, no request limits | "Attribution is required." Data is OpenStreetMap, ODbL. https://openfreemap.org · https://osmfoundation.org/wiki/Licence_and_Legal_FAQ | Use, with attribution everywhere the map appears, including the PDF (Finding 6) | **Use** (owner, 19 Oct 2026) |
| 9 | **ITU Maritime Identification Digits table** | First three MMSI digits to country; our "flag" | Yes | ITU's website terms allow download and use for personal, educational or non-commercial purposes with credit; commercial use needs prior written permission from ITU. https://www.itu.int/en/about/Pages/terms-of-use.aspx · table: https://www.itu.int/en/ITU-R/terrestrial/fmd/Pages/mid.aspx | The table is a short list of facts, but MarineEdge is a business tool, so this wording applies (Finding 8) | **Use** (owner, 19 Oct 2026). Open point: ITU's non-commercial wording. |
| 10 | **Equasis** | Ship particulars | Free with registration | Not used. Owner decision, 19 Oct 2026. Earlier finding (carried from TASKS.md, not re-checked): its notices forbid robots and storing its data without written permission. | Do not use | **Do not use** (owner decided) |
| 11 | **Global Fishing Watch** | Fishing and vessel events, not raw positions | Non-commercial and research use only | Not used. Owner decision, 19 Oct 2026: no permission requested, internal use only, attribution shown if it is ever used. Earlier finding (carried from TASKS.md, not re-checked): internal business use may still count as commercial. | Not needed by any task | **Not used now** (owner decided) |

**Also looked at and set aside:** MarineTraffic and VesselFinder (brief rule 4: no scraping; their data is sold under paid licences). AISHub (to get its feed you must contribute your own receiver feed; own receivers are out of scope).

## Findings that need the owner's attention

**1. AISStream has no written licence, and it is our only live source.**
Its documentation footer links only to Documentation, Account, Privacy and Support. Several public requests on its issue tracker (https://github.com/aisstream/issues/issues/290, /299, /289, /308) ask whether recording, storing and showing the data is allowed. In what I could open, I saw the questions but no answer from the operator. Two third-party projects that use it, aiscast and Open Waters, list it as having no published terms. So today we have no written permission and no written ban for what Task 7 does (record and store every position) or Task 18 does (show positions in a customer report).

- Until there is a written answer, keep the use internal and keep raw AISStream data out of anything shared with customers.
- **Already in play:** `data/ships.json` and `data/history/` are stored in the repo, and the Pages site shows live positions. If the repo is public, AISStream data is already published. I have not changed anything; this is reported only, as the rules ask.
- Suggested questions for AISStream, in writing: (a) may we record and store the messages; (b) may we show derived voyages and positions inside an internal tool and in a PDF report for customers; (c) what notice is given before the feed changes. Posting on its issue tracker is public, so the owner decides whether to ask there or by another route.

**2. Operating limits that affect Task 7 and Task 25** (from the AISStream docs page):
- No uptime guarantee, and events are not replayed. Gaps in our record are normal and will happen. This is a reason to build Task 25 (coverage map).
- At most 3 connections per account and per IP address. The server recorder and the GitHub Actions collector must not exceed that together.
- Direct browser connections are not allowed. Our collector runs server-side, so this is fine.
- Since September 2026, uncompressed connections have bandwidth limits and extra messages are dropped. `collect.mjs` already turns compression on (`perMessageDeflate: true`). The Task 7 recorder must do the same.
- Receivers are volunteers on land. Two third-party tool descriptions claim there is no coverage of the Persian Gulf, Hormuz or the Gulf of Oman. Our own `data/ships.json` in this zip lists 106 ships between latitudes 24.3 and 27.6 N and longitudes 51.9 and 57.7 E, so we hear ships in parts of that area. How much, and where, is what Task 25 measures. (TASKS.md says 27 ships in the latest file; that figure is out of date.)

**3. The EU list we planned to use has no vessels.**
The EU Financial Sanctions Files hold only asset freezes. Vessels under port-access and maritime-services bans (the Russian "shadow fleet" in Annex XLII of Regulation 833/2014, and the North Korea vessel annexes) are not in it. Source: https://www.opensanctions.org/docs/coverage/eu.md. Task 12 says to match EU, OFAC and UK lists on IMO. As written, EU-listed ships would be missed. The free official route is the Official Journal on EUR-Lex (row 4), whose legal notice now allows reuse. OpenSanctions already parses it, but its own licence is **not checked** and I do not recommend using it until it is.

**4. The UK list moved.**
The OFSI Consolidated List closed on 28 January 2026. The UK Sanctions List is now the only source, with CSV and XML files (https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv and `.xml`) and an IMO number field for ships. Task 12 should use these, not OFSI.

**5. EU download login.**
The EU file needs a free login, and the download links carry a token tied to that login. Treat the token like a key: GitHub Actions secret or uncommitted `.env` only.

**6. Attribution.**
On screen, MapLibre adds the OpenFreeMap credit by itself. A PDF or printed map does not. Task 18 must print "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" under the map. OpenFreeMap has no service guarantee either, so the interactive map has no promised uptime.

**7. Ship flags are indicators.**
Flag comes from the first three MMSI digits, not from a registry. The report should say so (the plan already treats it as an indicator).

**8. ITU wording is non-commercial.**
The MID table (first three MMSI digits to country) is what we use to show a flag. ITU's website terms allow non-commercial use with credit and ask for written permission for commercial use. The table is a short list of facts and the flag is only an indicator, so the practical risk looks small, but the wording does not match a business tool. Options: ask ITU for permission through the contact on its copyright page, or accept the risk. The owner has chosen "use".

## What I could not read

- AISStream's privacy policy page (blocked from my tools).
- The current NGA World Port Index download page itself (the "public release" lines come from the old 19th edition and NGA's 2022 briefing).
- OFAC's own terms page. Treasury's main privacy page (read) has a no-warranty notice and no reuse restriction, but no copyright statement either.
- The EU FSF website itself.

## Done when

Every row has an owner decision (rows 1 to 9: use; Equasis: do not use; Global Fishing Watch: not used now), and every "use" row has a licence line. Two "use" rows carry an open point the owner has accepted for now: AISStream (no written permission, Finding 1) and ITU (non-commercial wording, Finding 8).
