"""
═══════════════════════════════════════════════════════════════════════════
 NEXUS — coverage_api.py
 Ground station line-of-sight coverage matrix endpoint.
 Returns which satellites are currently visible from each ground station.
═══════════════════════════════════════════════════════════════════════════
"""

import math
from fastapi import APIRouter
from ..state_manager import state

router = APIRouter(prefix="/api/coverage", tags=["Coverage"])

RE_KM = 6371.0

GROUND_STATIONS = [
    {"id": "GS-BLR", "name": "Bengaluru",    "lat":  13.0333, "lon":  77.5167},
    {"id": "GS-SVB", "name": "Svalbard",      "lat":  78.2297, "lon":  15.4077},
    {"id": "GS-GLD", "name": "Goldstone",     "lat":  35.4266, "lon": -116.8900},
    {"id": "GS-PTA", "name": "Punta Arenas",  "lat": -53.1500, "lon": -70.9167},
    {"id": "GS-DEL", "name": "New Delhi",     "lat":  28.5450, "lon":  77.1926},
    {"id": "GS-MCM", "name": "McMurdo",       "lat": -77.8463, "lon": 166.6682},
]

MIN_ELEVATION_DEG = 5.0   # minimum elevation angle for LOS


def _elevation_angle(gs_lat, gs_lon, sat_lat, sat_lon, sat_alt_km):
    """
    Compute the elevation angle (degrees) of a satellite as seen from a ground station.
    Positive = above horizon.
    """
    # Convert to radians
    gs_lat_r  = math.radians(gs_lat)
    gs_lon_r  = math.radians(gs_lon)
    sat_lat_r = math.radians(sat_lat)
    sat_lon_r = math.radians(sat_lon)

    # Central angle between GS and sub-satellite point
    d_lon = sat_lon_r - gs_lon_r
    cos_central = (math.sin(gs_lat_r) * math.sin(sat_lat_r)
                   + math.cos(gs_lat_r) * math.cos(sat_lat_r) * math.cos(d_lon))
    cos_central = max(-1.0, min(1.0, cos_central))
    central_angle = math.acos(cos_central)   # radians

    # Orbital radius
    r_sat = RE_KM + sat_alt_km

    # Range from GS to satellite
    rho = math.sqrt(RE_KM**2 + r_sat**2 - 2 * RE_KM * r_sat * math.cos(central_angle))

    if rho < 1e-6:
        return 90.0

    # Elevation angle
    sin_el = (r_sat * math.cos(central_angle) - RE_KM) / rho
    elevation = math.degrees(math.asin(max(-1.0, min(1.0, sin_el))))
    return round(elevation, 2)


def _slant_range_km(gs_lat, gs_lon, sat_lat, sat_lon, sat_alt_km):
    """Slant range in km from ground station to satellite."""
    gs_lat_r  = math.radians(gs_lat)
    gs_lon_r  = math.radians(gs_lon)
    sat_lat_r = math.radians(sat_lat)
    sat_lon_r = math.radians(sat_lon)

    d_lon = sat_lon_r - gs_lon_r
    cos_c = (math.sin(gs_lat_r) * math.sin(sat_lat_r)
             + math.cos(gs_lat_r) * math.cos(sat_lat_r) * math.cos(d_lon))
    cos_c = max(-1.0, min(1.0, cos_c))
    c = math.acos(cos_c)

    r_sat = RE_KM + sat_alt_km
    rho = math.sqrt(RE_KM**2 + r_sat**2 - 2 * RE_KM * r_sat * math.cos(c))
    return round(rho, 1)


@router.get("")
async def get_coverage_matrix():
    """
    Returns a full coverage matrix: for each ground station, which satellites
    are currently in LOS, with elevation angle and slant range.
    """
    satellites = list(state.fleet.satellites.values())
    matrix = []

    for gs in GROUND_STATIONS:
        visible = []
        for sat in satellites:
            if sat.status == "EOL":
                continue
            el = _elevation_angle(gs["lat"], gs["lon"], sat.lat, sat.lon, sat.alt_km)
            if el >= MIN_ELEVATION_DEG:
                rng = _slant_range_km(gs["lat"], gs["lon"], sat.lat, sat.lon, sat.alt_km)
                visible.append({
                    "sat_id":        sat.id,
                    "status":        sat.status,
                    "elevation_deg": el,
                    "slant_range_km": rng,
                    "fuel_kg":       round(sat.fuel_kg, 2),
                })
        # Sort by elevation descending (best contact first)
        visible.sort(key=lambda x: -x["elevation_deg"])
        matrix.append({
            "gs":      gs,
            "visible": visible,
            "count":   len(visible),
        })

    # Summary
    total_links = sum(gs["count"] for gs in matrix)
    sats_in_contact = len({
        v["sat_id"]
        for gs in matrix
        for v in gs["visible"]
    })

    return {
        "matrix":           matrix,
        "total_links":      total_links,
        "sats_in_contact":  sats_in_contact,
        "total_sats":       len([s for s in satellites if s.status != "EOL"]),
        "sim_time":         state.sim_time.isoformat(),
        "min_elevation_deg": MIN_ELEVATION_DEG,
    }


@router.get("/satellite/{sat_id}")
async def get_satellite_coverage(sat_id: str):
    """
    For a specific satellite: which ground stations can see it right now,
    and how long until next contact for those that can't.
    """
    sat = state.fleet.satellites.get(sat_id)
    if not sat:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Satellite {sat_id} not found.")

    contacts = []
    for gs in GROUND_STATIONS:
        el  = _elevation_angle(gs["lat"], gs["lon"], sat.lat, sat.lon, sat.alt_km)
        rng = _slant_range_km(gs["lat"], gs["lon"], sat.lat, sat.lon, sat.alt_km)
        contacts.append({
            "gs":            gs,
            "elevation_deg": el,
            "slant_range_km": rng,
            "in_los":        el >= MIN_ELEVATION_DEG,
        })

    contacts.sort(key=lambda x: -x["elevation_deg"])
    return {
        "satellite_id": sat_id,
        "contacts":     contacts,
        "in_los_count": sum(1 for c in contacts if c["in_los"]),
        "sim_time":     state.sim_time.isoformat(),
    }
