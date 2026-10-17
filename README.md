# MarineEdge (React + TypeScript + Vite)

MarineEdge is a real-time maritime tracking application monitoring commercial cargo ships and tankers navigating the Strait of Hormuz, Persian Gulf, and the Gulf of Oman.

## Features

- **Interactive MapLibre GL Visualization**:
  - Live vessel positions rendered with directional heading arrows for moving vessels and circle markers for stationary/docked ships.
  - Distinct color-coding for Tankers (red) and Cargo ships (blue).
  - Historical voyage track line visualization for selected vessels.
  - Interactive port labels (Sohar, Muscat, Jebel Ali, Dubai, Fujairah, Bandar Abbas, etc.) visible at detailed zoom levels.
  - Selection highlight ring and automatic bounds framing.
  - Dynamic theme support for both light and dark display modes.
- **Vessel Directory & Filtering**:
  - Instant search across vessel name, MMSI, IMO number, destination, flag country, and ports.
  - Quick filters for Cargo, Tanker, Moving (`sog >= 1 kn`), and In Port.
  - Real-time time-ago reporting and operational status badge.
- **Detailed Vessel Dossier & Voyage Progress**:
  - Last visited port or current port zone.
  - Great-circle voyage progress estimation bar towards declared destination.
  - Speed, course, draught, vessel dimensions (length/beam), MMSI, IMO, last heard timestamp, and geographic coordinates.
  - Hazardous cargo category notices and vessel type insights.
- **Responsive Layout**:
  - Split-screen desktop workstation view with fixed sidebar and full-viewport map.
  - Mobile bottom navigation between Map and Ships directory.

## Technology Stack

- **React 18** with **TypeScript**
- **Vite** build tooling
- **MapLibre GL** for hardware-accelerated vector mapping
- **Tailwind CSS** for responsive styling with custom brutalist maritime design tokens