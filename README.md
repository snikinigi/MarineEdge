# MarineEdge

A live map of cargo ships and tankers around the Strait of Hormuz, the Persian Gulf and the Gulf of Oman.
Live site: https://snikinigi.github.io/MarineEdge/ (GitHub Pages, public).

## How it works

- **Collect.** The `collect` workflow (`.github/workflows/main.yml`) runs about every 20 minutes. `collect.mjs` listens to
  AISStream for about 7 minutes and merges what it hears into `data/ships.json`: cargo ships and tankers only, the last
  72 hours, inside a box around Oman, the UAE and Iran's Hormuz coast. It needs the `AISSTREAM_API_KEY` repository secret.
- **History.** After each collection, the `history` workflow runs `history.mjs`, which keeps a permanent log in
  `data/history/` and rebuilds `data/voyages.json` (port calls and voyages, using `voyages.mjs`). The app does not read
  `voyages.json` yet.
- **Deploy.** The `deploy` workflow (`.github/workflows/deploy.yml`) builds the React app and publishes it to GitHub Pages
  on every push to `main` and after each collection, using the latest `data/ships.json`.
  In the repository settings, Pages must use Source: GitHub Actions.

## Run it locally

```
npm install
npm run dev        # http://localhost:3000
npm run build      # type check + production build
node --test        # unit tests for the voyage logic
```

## Internal tool (in development)

The internal vessel due-diligence tool is being built next to the public map (see `docs/PLAN.md`). It needs Docker.

```
cp .env.example .env        # then edit .env and change the password
docker compose up --build   # starts the database, the backend and the frontend
```

- Frontend: http://localhost:3000 (a copy of the map screen; no ships until the API is wired in, Tasks 8 and 11)
- Backend health check: http://localhost:8000/health (answers `{"status":"ok", ...}` with the PostGIS version)
- Stop with `docker compose down`; add `-v` to also delete the database.
- Backend tests: `cd backend && pip install -r requirements.txt && python -m pytest`
- The `backend-tests` workflow (Actions tab) runs the tests, builds the frontend and starts the whole stack.
- Ports are bound to your own computer only. Never commit `.env`.

The public map above is unchanged and keeps deploying from the root of the repo.

## Code

- `src/`: React + TypeScript app (MapLibre map, ship list, ship sheet). Built with Vite and Tailwind CSS.
- `public/`: icons and the web app manifest.
- `collect.mjs`, `history.mjs`, `voyages.mjs`: data scripts run by GitHub Actions.
- `backend/`: FastAPI backend of the internal tool (Python). `frontend/`: its React + TypeScript screens (a copy of `src/` for now).
- `docker-compose.yml`, `.env.example`: how to start the internal tool locally.

## Status

Planned work is tracked in the task list, `docs/TASKS.md`. The product brief is `docs/BRIEF.md`. The sample report that shows the target layout is `docs/Sample_Vessel_Voyage_Report.pdf` (fictional ship, invented data).
