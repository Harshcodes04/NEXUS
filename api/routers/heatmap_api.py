"""
═══════════════════════════════════════════════════════════════════════════
 ACM — heatmap_api.py
 Collision risk density grid for the ground-track heatmap overlay.
═══════════════════════════════════════════════════════════════════════════
"""

import math
from fastapi import APIRouter
from ..state_manager import state

router = APIRouter(prefix="/api/heatmap", tags=["Heatmap"])

GRID_COLS = 72   # 5° longitude bins
GRID_ROWS = 36   # 5° latitude bins


@router.get("")
async def get_risk_heatmap():
    """
    Returns a lat/lon risk density grid based on:
      - Active CDMs (weighted by 1/miss_distance)
      - Debris positions (constant low background risk)
    Grid cells: 5°×5° bins, values 0.0–1.0 (normalised).
    """
    # Initialize zero grid
    grid = [[0.0] * GRID_COLS for _ in range(GRID_ROWS)]

    def _bin(lat, lon):
        col = int((lon + 180) / 5) % GRID_COLS
        row = int((lat + 90)  / 5) % GRID_ROWS
        return row, col

    # 1. Debris background risk
    debris_cloud = state.fleet.get_debris_snapshot()        # [[id,lat,lon,alt], …]
    for item in debris_cloud:
        try:
            lat, lon = float(item[1]), float(item[2])
            r, c = _bin(lat, lon)
            grid[r][c] += 0.01                              # small background weight
        except Exception:
            pass

    # 2. CDM risk — weighted by inverse miss distance (closer = more risk)
    for cdm in state.conj.active_cdms:
        sat = state.satellites.get(cdm.satelliteId)
        if not sat:
            continue
        lat, lon = sat.lat, sat.lon
        r, c = _bin(lat, lon)
        weight = 1.0 / max(cdm.missDistance, 0.001) * 0.5    # severity weight
        weight = min(weight, 5.0)                               # cap
        grid[r][c] += weight

        # Gaussian spread to 1 neighbour
        for dr in [-1, 0, 1]:
            for dc in [-1, 0, 1]:
                if dr == 0 and dc == 0:
                    continue
                nr, nc = (r + dr) % GRID_ROWS, (c + dc) % GRID_COLS
                grid[nr][nc] += weight * 0.2

    # 3. Normalise 0–1
    max_val = max(max(row) for row in grid) or 1.0
    normalised = [[round(v / max_val, 4) for v in row] for row in grid]

    return {
        "grid": normalised,
        "rows": GRID_ROWS,
        "cols": GRID_COLS,
        "cell_deg": 5,
        "cdm_count": len(state.conj.active_cdms),
        "debris_count": len(debris_cloud),
    }
