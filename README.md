# NEXUS — Navigation EXecutive for Unified Satellite ops

> Real-time autonomous satellite constellation management platform.

![NEXUS Dashboard](https://img.shields.io/badge/version-3.0.0-bc8cff?style=for-the-badge&logo=satellite)
![FastAPI](https://img.shields.io/badge/FastAPI-3.0-009688?style=for-the-badge&logo=fastapi)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python)

---

## Overview

NEXUS is a full-stack mission control platform for simulating and managing satellite constellations. It combines real-time orbital propagation, autonomous collision avoidance, and live telemetry visualization into a single glassmorphism dashboard.

### Core Capabilities

| Module | Description |
|--------|-------------|
| **Ground Track Map** | D3 Mercator projection with TopoJSON world atlas, debris canvas overlay, terminator line, and satellite trails |
| **Autonomous Evasion** | J2-perturbed RK4 propagator detects conjunctions and schedules evasion + recovery burns automatically |
| **Command Center** | Manual maneuver planning — dV slider, fuel cost gauge, strategy selector, real-time validation |
| **Analytics Dashboard** | Historical CDM timeline, per-satellite event bars, maneuver efficiency scatter, fuel depletion charts (D3) |
| **Collision Risk Heatmap** | 72×36 canvas overlay on ground track showing real-time risk density from debris + CDMs |
| **Live TLE Import** | Fetches real satellite positions from CelesTrak (ISS, Starlink, OneWeb, debris…) with Keplerian propagation |
| **Mission Designer** | Walker Delta/Star constellation builder — live ground-track preview, metrics, save/deploy into sim |
| **SQLite Analytics** | Every CDM, maneuver, alert, and fuel snapshot is persisted for long-term mission tracking |

---

## Architecture

```
nexus/
├── api/
│   ├── main.py                  # FastAPI app, WebSocket broadcast loop
│   ├── state_manager.py         # Central facade — sim + DB + fleet
│   ├── models.py                # Pydantic models (Satellite, CDM, Maneuver…)
│   ├── core/
│   │   ├── physics.py           # J2/RK4 propagator
│   │   ├── navigation.py        # ΔV planner, Tsiolkovsky fuel, RTN→ECI
│   │   ├── orbital_math.py      # Walker generator, Kepler→ECI, coverage math
│   │   └── screening.py         # KD-tree conjunction screener
│   ├── services/
│   │   ├── fleet_service.py     # Satellite + debris registry
│   │   ├── conjunction_service.py
│   │   ├── maneuver_service.py  # Burn scheduling, cooldown, LOS queuing
│   │   ├── decision_service.py  # Autonomous evasion engine
│   │   ├── simulation_service.py# Physics orchestration loop
│   │   ├── comms_service.py     # Ground station LOS check
│   │   ├── db_service.py        # SQLite analytics persistence
│   │   └── tle_service.py       # CelesTrak fetch + Keplerian propagation
│   └── routers/
│       ├── telemetry.py         # /api/telemetry
│       ├── maneuvers.py         # /api/maneuvers
│       ├── analytics_api.py     # /api/analytics/*
│       ├── heatmap_api.py       # /api/heatmap
│       ├── tle_api.py           # /api/tle/*
│       ├── designer_api.py      # /api/designer/*
│       └── rulebook_api.py      # Spec-compliant endpoints
├── frontend/
│   ├── index.html
│   ├── css/
│   │   ├── main.css             # Design system tokens + glassmorphism
│   │   ├── panels.css           # Layout panels
│   │   ├── animations.css       # Keyframes
│   │   ├── analytics.css        # Analytics dashboard styles
│   │   └── command_center.css   # Command center modal
│   └── js/
│       ├── main.js              # App entry point + WebSocket loop
│       ├── groundTrack.js       # D3 2D map
│       ├── analytics.js         # D3 charts
│       ├── heatmap.js           # Canvas risk overlay
│       ├── tle_import.js        # CelesTrak import panel
│       ├── designer.js          # Mission designer panel
│       ├── command_center.js    # Manual maneuver modal
│       ├── bullseye.js          # Conjunction radar chart
│       ├── gantt.js             # Maneuver timeline
│       ├── telemetry.js         # Telemetry panel
│       └── fuel.js              # Fuel status bars
└── data/
    ├── catalog.json             # Initial satellite + debris catalog
    └── ground_stations.csv      # Ground station positions
```

---

## Quick Start

### 1. Install dependencies

```bash
pip install fastapi uvicorn[standard] numpy scipy pydantic
# Optional: pip install sgp4  (enables full SGP4 TLE propagation)
```

### 2. Run the server

```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Open the dashboard

```
http://localhost:8000
```

### Docker

```bash
docker-compose up --build
```

---

## Simulation

### How It Works

NEXUS runs a **discrete-time physics loop** driven by the backend. Each tick advances the simulation clock by a configurable number of seconds (`step_seconds`) and updates every satellite's position, checks for conjunctions, and triggers autonomous responses.

```
tick ──► propagate orbits (RK4+J2)
     ──► KD-tree conjunction screen (threshold: 5 km)
     ──► if CDM detected ──► decision engine evaluates
                         ──► schedule evasion burn (RTN frame)
                         ──► persist CDM to SQLite
     ──► update fuel accounting (Tsiolkovsky)
     ──► broadcast snapshot via WebSocket
     ──► persist telemetry snapshot to SQLite
```

### Starting the Simulation

The simulation starts automatically on server boot. Use the **speed control bar** in the dashboard (bottom of screen) to adjust:

| Button | Action |
|--------|--------|
| ▶ / ⏸ | Play / Pause (`Space`) |
| ⏭ | Single step forward (`+`) |
| ⏹ | Stop & reset |
| 1× / 10× / 100× / 1000× | Simulation speed multiplier |

Or via API:

```bash
# Start auto-simulation at 1× speed (60s steps every 1s real-time)
curl -X POST "http://localhost:8000/api/simulation/start" \
  -H "Content-Type: application/json" \
  -d '{"step_seconds": 60, "interval_ms": 1000}'

# Stop
curl -X POST "http://localhost:8000/api/simulation/stop"

# Single step
curl -X POST "http://localhost:8000/api/simulation/step" \
  -d '{"step_seconds": 60}'
```

### Seeding the Constellation

On startup NEXUS loads `data/catalog.json` which contains the initial satellite and debris catalog. To reset and re-seed:

```bash
# Seed with default catalog (via script)
node scripts/seed.js

# Or regenerate the catalog from scratch
python data/generate_catalog.py
```

The catalog format:
```json
{
  "satellites": [
    {
      "id": "SAT-001",
      "r": { "x": 6771.0, "y": 0.0, "z": 0.0 },
      "v": { "x": 0.0, "y": 7.66, "z": 0.0 },
      "fuel_kg": 50.0,
      "status": "NOMINAL"
    }
  ],
  "debris": [
    [0, 52.3, 120.4, 550.0]
  ]
}
```

Debris entries are `[id_index, lat, lon, alt_km]` tuples for performance.

### Injecting Collision Threats

To trigger autonomous evasion maneuvers, inject a debris object near a satellite's current position:

```bash
# Python script — places debris 1 km from SAT-001
python scripts/inject_threat.py --sat SAT-001 --miss-distance 0.8

# Node.js version
node scripts/inject_threat.js
```

Or directly via the API:

```bash
curl -X POST "http://localhost:8000/api/debug/inject-threat" \
  -H "Content-Type: application/json" \
  -d '{"satellite_id": "SAT-001", "miss_distance_km": 0.8}'
```

Watch the dashboard — within 1–2 ticks the satellite status will change to `EVADING`, a CDM will appear in the alerts panel, and the bullseye chart will light up.

### Autonomous Evasion Pipeline

When the conjunction screener detects a miss distance below **5 km**:

1. **Decision Engine** evaluates risk priority (`miss_distance / closing_velocity`)
2. **Maneuver Planner** computes an RTN-frame burn:
   - Direction: radial-out (default) or along-track prograde
   - ΔV: scaled to achieve safe separation (`target: 10 km miss distance`)
   - Fuel cost: computed via Tsiolkovsky equation (`Isp = 220s, m₀ = 500 kg`)
3. **Constraints checked:**
   - Thruster cooldown: 600s minimum between burns
   - Max ΔV: 15 m/s per maneuver
   - Ground station LOS required (10s signal latency)
   - Minimum fuel reserve: 2 kg
4. **Burn scheduled** → satellite status → `EVADING`
5. **Recovery burn** scheduled automatically 2 orbit periods later → `RECOVERING` → `NOMINAL`

### Simulation State

At any time you can inspect the full simulation state:

```bash
# Full constellation snapshot
curl http://localhost:8000/api/visualization/snapshot

# Active CDMs
curl http://localhost:8000/api/cdms

# Scheduled maneuvers
curl http://localhost:8000/api/maneuvers

# Simulation clock + status
curl http://localhost:8000/api/simulation/status
```

---


## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/visualization/snapshot` | Live constellation snapshot |
| `GET`  | `/api/alerts` | Mission alerts (poll-based) |
| `POST` | `/api/maneuvers/schedule-evasion` | Schedule a maneuver burn |
| `GET`  | `/api/analytics/summary` | Historical mission statistics |
| `GET`  | `/api/analytics/cdms` | CDM history |
| `GET`  | `/api/analytics/fuel/{sat_id}` | Fuel depletion timeline |
| `GET`  | `/api/heatmap` | 72×36 collision risk grid |
| `GET`  | `/api/tle/import?group=starlink` | Import live TLE data |
| `GET`  | `/api/designer/preview/walker` | Walker constellation preview |
| `POST` | `/api/designer` | Save constellation design |
| `POST` | `/api/designer/{id}/deploy` | Deploy design into live sim |
| `WS`   | `/ws/telemetry` | Real-time telemetry stream |

Full interactive docs: `http://localhost:8000/docs`

---

## Physics

- **Propagator:** RK4 with J2 oblateness perturbation (Earth flattening)
- **Conjunction screening:** KD-tree spatial index, 5 km threshold
- **Maneuver planning:** RTN-frame burns, Tsiolkovsky rocket equation fuel costing
- **Constraints:** 10s signal latency, 600s thruster cooldown, 15 m/s thrust limit
- **Walker generator:** Closed-form Kepler → ECI conversion for constellation design

---

## Design System

The UI uses a custom glassmorphism design system with:
- CSS custom properties for all tokens (`--bg-primary`, `--blue`, `--purple`…)
- D3.js for all data visualizations
- JetBrains Mono for telemetry/data text
- Inter for UI chrome
- Smooth CSS transitions and keyframe animations throughout

---

## License

MIT — built for educational and personal mission control use.
