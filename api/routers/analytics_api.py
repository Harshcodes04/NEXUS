"""
═══════════════════════════════════════════════════════════════════════════
 ACM — analytics_api.py
 Analytics & mission history endpoints.
═══════════════════════════════════════════════════════════════════════════
"""

from fastapi import APIRouter, Query
from typing import Optional

from ..state_manager import state

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/summary")
async def get_fleet_summary():
    """Fleet-wide lifetime statistics."""
    return state.db.get_fleet_summary()


@router.get("/cdms")
async def get_cdm_history(
    limit: int = Query(100, ge=1, le=1000),
    satellite_id: Optional[str] = None
):
    """Historical CDM detections."""
    return {"cdms": state.db.get_cdm_history(limit=limit, satellite_id=satellite_id)}


@router.get("/maneuvers")
async def get_maneuver_history(
    limit: int = Query(100, ge=1, le=1000),
    satellite_id: Optional[str] = None
):
    """Historical maneuver executions."""
    return {"maneuvers": state.db.get_maneuver_history(limit=limit, satellite_id=satellite_id)}


@router.get("/alerts")
async def get_alert_history(limit: int = Query(200, ge=1, le=2000)):
    """Historical mission alerts."""
    return {"alerts": state.db.get_alert_history(limit=limit)}


@router.get("/satellite/{satellite_id}")
async def get_satellite_lifetime(satellite_id: str):
    """Full lifetime statistics for a single satellite."""
    sat = state.satellites.get(satellite_id)
    if not sat:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Satellite {satellite_id} not found")
    return state.db.get_satellite_lifetime(satellite_id)


@router.get("/fuel/{satellite_id}")
async def get_fuel_timeline(satellite_id: str, limit: int = Query(500, ge=1, le=2000)):
    """Fuel depletion timeline for a satellite."""
    return {"fuel_timeline": state.db.get_fuel_timeline(satellite_id, limit=limit)}
