# Changelog

All notable changes to NEXUS are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [3.0.0] — 2026-04-23

### Added
- **Ground Station Coverage Matrix** — real-time LOS elevation angles and slant ranges for 6 global stations (`/api/coverage`)
- **Mission Designer** — Walker Delta/Star constellation builder with live D3 ground-track preview and one-click deploy into running simulation (`/api/designer/*`)
- **Live TLE Import** — CelesTrak integration with Keplerian propagation fallback, 1-hour server-side cache (`/api/tle/*`)
- **Collision Risk Heatmap** — 72×36 canvas overlay on ground-track map with toggle and colour-gradient legend (`/api/heatmap`)
- **Mission Analytics Dashboard** — D3 charts for CDM timeline, maneuver efficiency scatter, fuel depletion area chart, alert log (`/api/analytics/*`)
- **Maneuver Command Center** — manual burn planning modal with dV slider, real-time fuel cost, strategy selector
- **SQLite Analytics Persistence** — every CDM, maneuver, alert, and fuel snapshot auto-persisted via `db_service.py`
- **Orbital Math Library** — `api/core/orbital_math.py` with Walker generator, Kepler→ECI, ECI→geodetic, period/footprint/revisit estimators
- NEXUS branding (renamed from AutoCM)

### Changed
- FastAPI app version bumped to `3.0.0`
- All JS/CSS file headers updated to NEXUS
- `state_manager.py` hooked into `db_service` for automatic event persistence

---

## [2.0.0] — 2026-04-22

### Added
- Removed demo-mode fallbacks — live backend only
- Simulation speed control bar (1×, 10×, 100×, 1000×) with play/pause/step
- Satellite detail drawer with fuel bar, CDM table, maneuver history
- Bullseye conjunction radar chart (D3)
- Maneuver Gantt timeline (D3)
- Telemetry WebSocket panel
- Rulebook-compliant API endpoints

### Changed
- Frontend fully modularized (separate JS files per panel)
- Ground track canvas debris rendering (10k objects)
- Glassmorphism design system with CSS custom properties

---

## [1.0.0] — 2026-04-16

### Added
- Initial FastAPI backend with WebSocket telemetry
- Satellite and debris catalog generation
- J2/RK4 orbital propagator
- KD-tree conjunction screener
- RTN-frame autonomous evasion engine
- D3 Mercator ground track map
- Basic satellite panel
