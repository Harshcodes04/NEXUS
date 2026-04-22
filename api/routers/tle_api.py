"""
═══════════════════════════════════════════════════════════════════════════
 ACM — tle_api.py
 Live TLE import and satellite listing endpoints.
═══════════════════════════════════════════════════════════════════════════
"""

from fastapi import APIRouter, Query, HTTPException, BackgroundTasks
from typing import Optional
from ..services.tle_service import TLEService

router = APIRouter(prefix="/api/tle", tags=["TLE Import"])

# Shared singleton — maintains the 1-hour cache
_svc = TLEService()


@router.get("/groups")
async def list_groups():
    """List available TLE groups from CelesTrak."""
    return {
        "groups": _svc.get_available_groups(),
        "sgp4_available": _svc.has_sgp4(),
    }


@router.get("/import")
async def import_tle(
    group: str = Query("stations", description="CelesTrak group name"),
    limit: int = Query(30,  ge=1, le=200, description="Max satellites to return"),
):
    """
    Fetch and propagate a TLE group from CelesTrak.
    Returns current lat/lon/alt for each satellite.
    Results are cached for 1 hour.
    """
    try:
        sats = _svc.fetch_group(group=group, max_sats=limit)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return {
        "group":  group,
        "count":  len(sats),
        "satellites": sats,
        "propagator": "sgp4" if _svc.has_sgp4() else "kepler",
    }


@router.get("/satellite/{norad_id}")
async def get_satellite_tle(norad_id: str):
    """
    Look up a specific satellite by NORAD ID across all cached groups.
    """
    for group_sats in _svc._cache.values():
        for sat in group_sats:
            if sat.get("norad") == norad_id:
                return sat
    raise HTTPException(status_code=404, detail=f"NORAD {norad_id} not found in cache. Import a group first.")


@router.get("/status")
async def tle_status():
    """Show which groups are currently cached and when they expire."""
    import time
    now = time.time()
    cache_info = []
    for group, ts in _svc._cache_ts.items():
        age_s = int(now - ts)
        ttl_s = max(0, _svc._cache_ttl - age_s)
        cache_info.append({
            "group":    group,
            "count":    len(_svc._cache.get(group, [])),
            "age_s":    age_s,
            "ttl_s":    ttl_s,
            "fresh":    ttl_s > 0,
        })
    return {
        "cached_groups": cache_info,
        "sgp4_available": _svc.has_sgp4(),
    }
