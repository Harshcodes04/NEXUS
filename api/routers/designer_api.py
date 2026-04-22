"""
═══════════════════════════════════════════════════════════════════════════
 NEXUS — designer_api.py
 Satellite Mission Designer — CRUD endpoints for constellation design.
 Designs live in an in-memory store (+ SQLite persistence via db_service).
═══════════════════════════════════════════════════════════════════════════
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..core.orbital_math import (
    walker_delta, walker_star,
    orbital_period_minutes, ground_coverage_deg, revisit_time_minutes,
)

router = APIRouter(prefix="/api/designer", tags=["Mission Designer"])

# ── In-memory design store ─────────────────────────────────────────────────
# { design_id: { ...design dict... } }
_designs: Dict[str, dict] = {}


# ── Pydantic schemas ───────────────────────────────────────────────────────

class WalkerParams(BaseModel):
    total_sats:    int   = Field(12,    ge=1,  le=200)
    planes:        int   = Field(3,     ge=1,  le=50)
    phasing:       int   = Field(1,     ge=0,  le=49)
    alt_km:        float = Field(550.0, ge=200, le=36000)
    inc_deg:       float = Field(53.0,  ge=0,  le=180)
    pattern:       str   = Field("delta", description="'delta' or 'star'")
    min_elevation: float = Field(5.0,  ge=0,  le=45)


class DesignCreate(BaseModel):
    name:        str          = Field(..., min_length=1, max_length=80)
    description: Optional[str] = ""
    params:      WalkerParams


class DesignUpdate(BaseModel):
    name:        Optional[str]          = None
    description: Optional[str]         = None
    params:      Optional[WalkerParams] = None


# ── Helpers ────────────────────────────────────────────────────────────────

def _generate_constellation(params: WalkerParams, prefix: str = "NEXUS") -> dict:
    """Run the appropriate Walker generator and compute metrics."""
    gen = walker_delta if params.pattern == "delta" else walker_star
    kwargs = dict(
        total_sats=params.total_sats,
        planes=params.planes,
        alt_km=params.alt_km,
        inc_deg=params.inc_deg,
        id_prefix=prefix,
    )
    if params.pattern == "delta":
        kwargs["phasing"] = params.phasing

    satellites = gen(**kwargs)

    period     = orbital_period_minutes(params.alt_km)
    coverage   = ground_coverage_deg(params.alt_km, params.min_elevation)
    revisit    = revisit_time_minutes(params.total_sats, params.alt_km,
                                      params.inc_deg, params.min_elevation)
    return {
        "satellites":   satellites,
        "metrics": {
            "orbital_period_min": period,
            "footprint_half_angle_deg": coverage,
            "approx_revisit_time_min": revisit,
            "total_sats": len(satellites),
            "planes": params.planes,
            "alt_km": params.alt_km,
            "inc_deg": params.inc_deg,
            "pattern": params.pattern,
        },
    }


def _design_summary(d: dict) -> dict:
    """Lightweight summary (no satellite array) for list view."""
    return {k: v for k, v in d.items() if k != "satellites"}


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_designs():
    """List all saved constellation designs."""
    return {
        "designs": [_design_summary(d) for d in _designs.values()],
        "count":   len(_designs),
    }


@router.post("", status_code=201)
async def create_design(body: DesignCreate):
    """
    Create a new constellation design.
    Generates satellite positions using the Walker algorithm.
    """
    design_id = str(uuid.uuid4())[:8]
    prefix    = body.name.upper().replace(" ", "")[:6] or "NEXUS"

    constellation = _generate_constellation(body.params, prefix=prefix)

    design = {
        "id":          design_id,
        "name":        body.name,
        "description": body.description or "",
        "params":      body.params.model_dump(),
        "metrics":     constellation["metrics"],
        "satellites":  constellation["satellites"],
        "created_at":  datetime.now(timezone.utc).isoformat(),
        "updated_at":  datetime.now(timezone.utc).isoformat(),
    }
    _designs[design_id] = design

    return {"design": design, "message": f"Design '{body.name}' created with {len(constellation['satellites'])} satellites."}


@router.get("/{design_id}")
async def get_design(design_id: str):
    """Get a full design including all satellite positions."""
    d = _designs.get(design_id)
    if not d:
        raise HTTPException(status_code=404, detail=f"Design {design_id} not found.")
    return {"design": d}


@router.put("/{design_id}")
async def update_design(design_id: str, body: DesignUpdate):
    """Update a design's name, description, or regenerate with new parameters."""
    d = _designs.get(design_id)
    if not d:
        raise HTTPException(status_code=404, detail=f"Design {design_id} not found.")

    if body.name is not None:
        d["name"] = body.name
    if body.description is not None:
        d["description"] = body.description
    if body.params is not None:
        prefix = d["name"].upper().replace(" ", "")[:6] or "NEXUS"
        constellation = _generate_constellation(body.params, prefix=prefix)
        d["params"]     = body.params.model_dump()
        d["metrics"]    = constellation["metrics"]
        d["satellites"] = constellation["satellites"]

    d["updated_at"] = datetime.now(timezone.utc).isoformat()
    return {"design": d, "message": "Design updated."}


@router.delete("/{design_id}", status_code=204)
async def delete_design(design_id: str):
    """Delete a constellation design."""
    if design_id not in _designs:
        raise HTTPException(status_code=404, detail=f"Design {design_id} not found.")
    del _designs[design_id]


@router.post("/{design_id}/deploy")
async def deploy_design(design_id: str):
    """
    Deploy a designed constellation into the live simulation.
    Adds all designed satellites to the running state_manager fleet.
    """
    d = _designs.get(design_id)
    if not d:
        raise HTTPException(status_code=404, detail=f"Design {design_id} not found.")

    from ..state_manager import state
    from ..models import Satellite, Vector3

    added   = []
    skipped = []

    for sat_dict in d["satellites"]:
        sat_id = sat_dict["id"]
        if sat_id in state.satellites:
            skipped.append(sat_id)
            continue
        sat = Satellite(
            id=sat_id,
            r=Vector3(**sat_dict["state"]["r"]),
            v=Vector3(**sat_dict["state"]["v"]),
            fuel_kg=sat_dict.get("fuel_kg", 50.0),
            status="NOMINAL",
        )
        sat.lat    = sat_dict["lat"]
        sat.lon    = sat_dict["lon"]
        sat.alt_km = sat_dict["alt_km"]
        state.fleet.add_satellite(sat)
        added.append(sat_id)

    state._add_alert(
        type="DESIGN_DEPLOYED",
        level="INFO",
        msg=f"Constellation '{d['name']}' deployed: {len(added)} satellites added.",
    )

    return {
        "message": f"Deployed '{d['name']}': {len(added)} added, {len(skipped)} already existed.",
        "added":   added,
        "skipped": skipped,
    }


@router.get("/preview/walker")
async def preview_walker(
    total_sats: int   = 12,
    planes:     int   = 3,
    phasing:    int   = 1,
    alt_km:     float = 550.0,
    inc_deg:    float = 53.0,
    pattern:    str   = "delta",
    min_elevation: float = 5.0,
):
    """
    Quick preview — generate a Walker constellation without saving it.
    Returns lat/lon positions + metrics for live map preview.
    """
    params = WalkerParams(
        total_sats=total_sats, planes=planes, phasing=phasing,
        alt_km=alt_km, inc_deg=inc_deg, pattern=pattern,
        min_elevation=min_elevation,
    )
    result = _generate_constellation(params, prefix="PREVIEW")
    # Return only positions for frontend overlay (not full state vectors)
    positions = [
        {"id": s["id"], "lat": s["lat"], "lon": s["lon"],
         "alt_km": s["alt_km"], "plane": s["plane"], "slot": s["slot"]}
        for s in result["satellites"]
    ]
    return {"positions": positions, "metrics": result["metrics"]}
