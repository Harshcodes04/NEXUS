"""
═══════════════════════════════════════════════════════════════════════════
 NEXUS — orbital_math.py
 Orbital mechanics utilities:
   • Walker constellation generator (Delta, Star, custom)
   • Kepler elements → ECI state vectors
   • ECI → lat/lon/alt
═══════════════════════════════════════════════════════════════════════════
"""

import math
from typing import List, Dict, Tuple
from datetime import datetime, timezone

MU_KM3_S2 = 398600.4418   # Earth GM  (km³/s²)
RE_KM      = 6371.0        # Earth radius (km)
J2         = 1.08263e-3    # J2 oblateness coefficient


# ── Kepler → ECI ──────────────────────────────────────────────────────────

def kepler_to_eci(
    sma_km: float,          # semi-major axis (km)
    ecc: float,             # eccentricity
    inc_deg: float,         # inclination (deg)
    raan_deg: float,        # right ascension of ascending node (deg)
    aop_deg: float,         # argument of perigee (deg)
    ta_deg: float,          # true anomaly (deg)
) -> Tuple[List[float], List[float]]:
    """
    Convert Keplerian orbital elements to ECI position [km] and velocity [km/s].
    """
    inc  = math.radians(inc_deg)
    raan = math.radians(raan_deg)
    aop  = math.radians(aop_deg)
    ta   = math.radians(ta_deg)

    # Orbital radius
    p   = sma_km * (1 - ecc ** 2)
    r   = p / (1 + ecc * math.cos(ta))

    # Position in perifocal frame
    r_pf = [r * math.cos(ta), r * math.sin(ta), 0.0]

    # Velocity in perifocal frame
    sqrt_mu_p = math.sqrt(MU_KM3_S2 / p)
    v_pf = [
        -sqrt_mu_p * math.sin(ta),
         sqrt_mu_p * (ecc + math.cos(ta)),
         0.0,
    ]

    # Rotation matrix: perifocal → ECI
    R = _rot_pf_to_eci(raan, inc, aop)

    r_eci = _mat_vec(R, r_pf)
    v_eci = _mat_vec(R, v_pf)

    return r_eci, v_eci


def _rot_pf_to_eci(raan: float, inc: float, aop: float):
    """3×3 rotation matrix from perifocal to ECI frame."""
    cos_r, sin_r = math.cos(raan), math.sin(raan)
    cos_i, sin_i = math.cos(inc),  math.sin(inc)
    cos_a, sin_a = math.cos(aop),  math.sin(aop)

    return [
        [
            cos_r * cos_a - sin_r * sin_a * cos_i,
            -cos_r * sin_a - sin_r * cos_a * cos_i,
             sin_r * sin_i,
        ],
        [
            sin_r * cos_a + cos_r * sin_a * cos_i,
            -sin_r * sin_a + cos_r * cos_a * cos_i,
            -cos_r * sin_i,
        ],
        [
            sin_a * sin_i,
            cos_a * sin_i,
            cos_i,
        ],
    ]


def _mat_vec(M, v):
    return [sum(M[i][j] * v[j] for j in range(3)) for i in range(3)]


# ── ECI → Geodetic ────────────────────────────────────────────────────────

def eci_to_latlon_simple(r_km: List[float]) -> Tuple[float, float, float]:
    """
    Convert ECI position to geodetic lat/lon/alt at the current UTC epoch.
    (Uses GST rotation — fast, good enough for display.)
    """
    now = datetime.now(timezone.utc)
    x, y, z = r_km[0], r_km[1], r_km[2]

    # Greenwich sidereal time
    jd_now = _jd_now(now)
    T = (jd_now - 2451545.0) / 36525.0
    gst_deg = (280.46061837 + 360.98564736629 * (jd_now - 2451545.0)
               + 0.000387933 * T ** 2) % 360.0
    gst_rad = math.radians(gst_deg)

    lon_rad = math.atan2(y, x) - gst_rad
    lon = ((math.degrees(lon_rad) + 180) % 360) - 180

    r_mag = math.sqrt(x**2 + y**2 + z**2)
    lat   = math.degrees(math.asin(z / r_mag))
    alt   = r_mag - RE_KM

    return round(lat, 4), round(lon, 4), round(alt, 2)


def _jd_now(dt: datetime) -> float:
    a = (14 - dt.month) // 12
    y = dt.year + 4800 - a
    m = dt.month + 12 * a - 3
    jdn = (dt.day + (153 * m + 2) // 5 + 365 * y
           + y // 4 - y // 100 + y // 400 - 32045)
    fr  = (dt.hour + dt.minute / 60 + dt.second / 3600
           + dt.microsecond / 3.6e9) / 24 - 0.5
    return float(jdn) + fr


# ── Walker Constellation Generator ────────────────────────────────────────

def walker_delta(
    total_sats: int,      # T — total satellites
    planes: int,          # P — number of orbital planes
    phasing: int,         # F — relative spacing (0 .. P-1)
    alt_km: float,        # altitude above Earth (km)
    inc_deg: float,       # inclination (degrees)
    id_prefix: str = "NEXUS",
) -> List[Dict]:
    """
    Generate a Walker Delta constellation (T/P/F).
    Returns list of satellite dicts with Keplerian elements + ECI state.
    """
    sma_km = RE_KM + alt_km
    sats_per_plane = total_sats // planes
    # RAAN spacing between planes
    d_raan = 360.0 / planes
    # Mean anomaly spacing within a plane
    d_ma   = 360.0 / sats_per_plane
    # Phasing offset
    d_phase = phasing * 360.0 / total_sats

    satellites = []
    sat_num = 0

    for p in range(planes):
        raan = p * d_raan
        for s in range(sats_per_plane):
            ta = (s * d_ma + p * d_phase) % 360.0
            r_eci, v_eci = kepler_to_eci(
                sma_km=sma_km,
                ecc=0.0,
                inc_deg=inc_deg,
                raan_deg=raan,
                aop_deg=0.0,
                ta_deg=ta,
            )
            lat, lon, alt_actual = eci_to_latlon_simple(r_eci)
            sat_num += 1
            satellites.append({
                "id":     f"{id_prefix}-{sat_num:02d}",
                "plane":  p + 1,
                "slot":   s + 1,
                "elements": {
                    "sma_km":    round(sma_km, 2),
                    "ecc":       0.0,
                    "inc_deg":   round(inc_deg, 2),
                    "raan_deg":  round(raan, 2),
                    "aop_deg":   0.0,
                    "ta_deg":    round(ta, 2),
                },
                "state": {
                    "r": {"x": round(r_eci[0], 4),
                           "y": round(r_eci[1], 4),
                           "z": round(r_eci[2], 4)},
                    "v": {"x": round(v_eci[0], 6),
                           "y": round(v_eci[1], 6),
                           "z": round(v_eci[2], 6)},
                },
                "lat":    lat,
                "lon":    lon,
                "alt_km": round(alt_actual, 2),
                "fuel_kg": 50.0,
                "status":  "NOMINAL",
            })

    return satellites


def walker_star(
    total_sats: int,
    planes: int,
    alt_km: float,
    inc_deg: float = 90.0,
    id_prefix: str = "NEXUS",
) -> List[Dict]:
    """Walker Star (polar): F=0, inc near 90°, RAAN spans 180°."""
    sma_km = RE_KM + alt_km
    sats_per_plane = total_sats // planes
    d_raan = 180.0 / planes   # spans only 180° for polar
    d_ma   = 360.0 / sats_per_plane

    satellites = []
    sat_num = 0

    for p in range(planes):
        raan = p * d_raan
        for s in range(sats_per_plane):
            ta = (s * d_ma) % 360.0
            r_eci, v_eci = kepler_to_eci(
                sma_km=sma_km, ecc=0.0, inc_deg=inc_deg,
                raan_deg=raan, aop_deg=0.0, ta_deg=ta,
            )
            lat, lon, alt_actual = eci_to_latlon_simple(r_eci)
            sat_num += 1
            satellites.append({
                "id":     f"{id_prefix}-{sat_num:02d}",
                "plane":  p + 1,
                "slot":   s + 1,
                "elements": {
                    "sma_km":   round(sma_km, 2),
                    "ecc":      0.0,
                    "inc_deg":  round(inc_deg, 2),
                    "raan_deg": round(raan, 2),
                    "aop_deg":  0.0,
                    "ta_deg":   round(ta, 2),
                },
                "state": {
                    "r": {"x": round(r_eci[0], 4),
                           "y": round(r_eci[1], 4),
                           "z": round(r_eci[2], 4)},
                    "v": {"x": round(v_eci[0], 6),
                           "y": round(v_eci[1], 6),
                           "z": round(v_eci[2], 6)},
                },
                "lat": lat, "lon": lon, "alt_km": round(alt_actual, 2),
                "fuel_kg": 50.0, "status": "NOMINAL",
            })

    return satellites


# ── Orbital period & coverage helpers ─────────────────────────────────────

def orbital_period_minutes(alt_km: float) -> float:
    """Keplerian period for circular orbit at given altitude."""
    sma = RE_KM + alt_km
    return round(2 * math.pi * math.sqrt(sma ** 3 / MU_KM3_S2) / 60, 2)


def ground_coverage_deg(alt_km: float, min_elevation_deg: float = 5.0) -> float:
    """
    Half-angle of nadir-pointing circular ground coverage footprint.
    """
    rho = math.asin(RE_KM / (RE_KM + alt_km))
    el  = math.radians(min_elevation_deg)
    earth_angle = math.pi / 2 - el - rho
    return round(math.degrees(earth_angle), 2)


def revisit_time_minutes(
    total_sats: int,
    alt_km: float,
    inc_deg: float,
    min_elevation_deg: float = 5.0,
) -> float:
    """
    Approximate average revisit time (minutes) for a constellation.
    Simplified analytic estimate.
    """
    period = orbital_period_minutes(alt_km)
    coverage = ground_coverage_deg(alt_km, min_elevation_deg)
    # Fraction of Earth strip covered per pass
    fraction = (2 * coverage) / 360.0
    # Effective coverage with N sats (very approximate)
    coverage_ratio = min(1.0, total_sats * fraction * math.sin(math.radians(inc_deg)))
    if coverage_ratio <= 0:
        return float('inf')
    return round(period / (total_sats * fraction), 1)
