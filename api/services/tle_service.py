"""
═══════════════════════════════════════════════════════════════════════════
 ACM — tle_service.py
 Live TLE import: fetches Two-Line Element sets from CelesTrak and
 propagates them into lat/lon/alt positions using sgp4 (if available)
 or a simplified Keplerian fallback.
═══════════════════════════════════════════════════════════════════════════
"""

import math
import json
import time
import urllib.request
from datetime import datetime, timezone
from typing import List, Dict, Optional, Tuple

# Try to import sgp4 (optional — falls back to simplified propagation)
try:
    from sgp4.api import Satrec, WGS84
    from sgp4.conveniences import sat_epoch_datetime
    _HAS_SGP4 = True
except ImportError:
    _HAS_SGP4 = False

# ── CelesTrak sources ─────────────────────────────────────────────────────
CELESTRAK_SOURCES = {
    "stations":    "https://celestrak.org/SOCRATES/query.php?GROUP=stations&FORMAT=tle",
    "starlink":    "https://celestrak.org/SOCRATES/query.php?GROUP=starlink&FORMAT=tle",
    "oneweb":      "https://celestrak.org/SOCRATES/query.php?GROUP=oneweb&FORMAT=tle",
    "debris":      "https://celestrak.org/SOCRATES/query.php?GROUP=cosmos-1408-debris&FORMAT=tle",
}
# Simpler, more reliable endpoints
CELESTRAK_URLS = {
    "stations": "https://celestrak.org/SOCRATES/query.php?GROUP=stations&FORMAT=tle",
    "starlink":  "https://celestrak.org/pub/TLE/catalog.txt",
}
# Use gp.php endpoint — most reliable
GP_URL_TMPL = "https://celestrak.org/SOCRATES/query.php?GROUP={group}&FORMAT=tle"


class TLEService:
    """
    Fetches, caches, and propagates real-world TLE data from CelesTrak.
    """

    def __init__(self):
        self._cache: Dict[str, List[Dict]] = {}   # group -> list of sat dicts
        self._cache_ts: Dict[str, float]   = {}   # group -> fetch timestamp
        self._cache_ttl = 3600             # 1-hour cache TTL

    # ── Fetch ─────────────────────────────────────────────────────────────

    def fetch_group(self, group: str = "stations", max_sats: int = 30) -> List[Dict]:
        """
        Downloads a TLE group from CelesTrak.
        Returns a list of parsed satellite dicts with current lat/lon/alt.
        Results are cached for 1 hour to be polite to CelesTrak.
        """
        now = time.time()
        if group in self._cache and (now - self._cache_ts.get(group, 0)) < self._cache_ttl:
            return self._cache[group][:max_sats]

        url = f"https://celestrak.org/SOCRATES/query.php?GROUP={group}&FORMAT=tle"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AutoCM/2.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                text = resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            # Fallback: return cached data even if stale
            if group in self._cache:
                return self._cache[group][:max_sats]
            raise RuntimeError(f"CelesTrak fetch failed: {e}")

        lines = [l.strip() for l in text.splitlines() if l.strip()]
        sats  = self._parse_tle_lines(lines)
        sats  = sats[:max_sats]

        self._cache[group]    = sats
        self._cache_ts[group] = now
        return sats

    def fetch_url(self, url: str, max_sats: int = 50) -> List[Dict]:
        """Fetch TLE data from an arbitrary URL."""
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AutoCM/2.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                text = resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            raise RuntimeError(f"TLE fetch failed: {e}")
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        return self._parse_tle_lines(lines)[:max_sats]

    # ── Parse ─────────────────────────────────────────────────────────────

    def _parse_tle_lines(self, lines: List[str]) -> List[Dict]:
        """
        Parse a TLE file (name / line1 / line2 triplets).
        Returns list of propagated satellite position dicts.
        """
        sats = []
        i = 0
        while i < len(lines) - 2:
            name  = lines[i]
            line1 = lines[i + 1]
            line2 = lines[i + 2]

            if not (line1.startswith("1 ") and line2.startswith("2 ")):
                i += 1
                continue

            try:
                sat_dict = self._propagate(name, line1, line2)
                if sat_dict:
                    sats.append(sat_dict)
            except Exception:
                pass

            i += 3

        return sats

    # ── Propagate ─────────────────────────────────────────────────────────

    def _propagate(self, name: str, line1: str, line2: str) -> Optional[Dict]:
        """
        Compute current lat/lon/alt from TLE using sgp4 (if available)
        or a simplified 2-body Keplerian approximation.
        """
        now = datetime.now(timezone.utc)

        if _HAS_SGP4:
            return self._propagate_sgp4(name, line1, line2, now)
        else:
            return self._propagate_kepler(name, line1, line2, now)

    def _propagate_sgp4(self, name, line1, line2, now) -> Optional[Dict]:
        """Full SGP4 propagation."""
        try:
            sat  = Satrec.twoline2rv(line1, line2)
            jd, fr = _datetime_to_jd(now)
            e, r, v = sat.sgp4(jd, fr)
            if e != 0:
                return None
            lat, lon, alt = _eci_to_latlon(r, now)
            speed_kms = math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)
            return {
                "id":      f"TLE-{name.strip()[:16]}",
                "name":    name.strip(),
                "norad":   line1[2:7].strip(),
                "lat":     round(lat, 4),
                "lon":     round(lon, 4),
                "alt_km":  round(alt, 1),
                "speed_kms": round(speed_kms, 3),
                "source":  "celestrak",
                "propagator": "sgp4",
                "tle_line1": line1,
                "tle_line2": line2,
            }
        except Exception:
            return None

    def _propagate_kepler(self, name, line1, line2, now) -> Optional[Dict]:
        """
        Simplified Keplerian propagation from TLE elements.
        Accurate to ~10-50 km over short periods — good enough for display.
        """
        try:
            # Parse TLE fields
            inc_deg     = float(line2[8:16])
            raan_deg    = float(line2[17:25])
            ecc_raw     = float("0." + line2[26:33])
            arg_peri_deg= float(line2[34:42])
            mean_anom_deg= float(line2[43:51])
            mean_motion  = float(line2[52:63])   # revs/day

            # TLE epoch
            epoch_year   = int(line1[18:20])
            epoch_day    = float(line1[20:32])
            if epoch_year < 57:
                epoch_year += 2000
            else:
                epoch_year += 1900
            epoch_dt = _tle_epoch_to_datetime(epoch_year, epoch_day)

            # Time since epoch
            dt_sec = (now - epoch_dt).total_seconds()

            # Semi-major axis from mean motion (km)
            n_rads = mean_motion * 2 * math.pi / 86400  # rad/s
            MU     = 398600.4418                          # km³/s²
            a      = (MU / (n_rads**2)) ** (1/3)

            # Propagate mean anomaly
            M = math.radians(mean_anom_deg) + n_rads * dt_sec
            M = M % (2 * math.pi)

            # Eccentric anomaly (Newton-Raphson, 5 iters)
            E = M
            for _ in range(5):
                E = E - (E - ecc_raw * math.sin(E) - M) / (1 - ecc_raw * math.cos(E))

            # True anomaly
            nu = 2 * math.atan2(
                math.sqrt(1 + ecc_raw) * math.sin(E / 2),
                math.sqrt(1 - ecc_raw) * math.cos(E / 2)
            )

            # Orbital radius
            r_km = a * (1 - ecc_raw * math.cos(E))
            alt  = r_km - 6371.0

            # Position in perifocal frame → ECI → lat/lon
            inc  = math.radians(inc_deg)
            raan = math.radians(raan_deg)
            w    = math.radians(arg_peri_deg)

            # ECI position
            cos_nu, sin_nu   = math.cos(nu), math.sin(nu)
            cos_w,  sin_w    = math.cos(w),  math.sin(w)
            cos_i,  sin_i    = math.cos(inc), math.sin(inc)
            cos_raan, sin_raan = math.cos(raan), math.sin(raan)

            # Perifocal to ECI
            px = r_km * cos_nu
            py = r_km * sin_nu

            x = (cos_raan * cos_w - sin_raan * sin_w * cos_i) * px + \
                (-cos_raan * sin_w - sin_raan * cos_w * cos_i) * py
            y = (sin_raan * cos_w + cos_raan * sin_w * cos_i) * px + \
                (-sin_raan * sin_w + cos_raan * cos_w * cos_i) * py
            z = (sin_w * sin_i) * px + (cos_w * sin_i) * py

            lat, lon, _ = _eci_to_latlon([x, y, z], now)

            return {
                "id":      f"TLE-{name.strip()[:16]}",
                "name":    name.strip(),
                "norad":   line1[2:7].strip(),
                "lat":     round(lat, 4),
                "lon":     round(lon, 4),
                "alt_km":  round(alt, 1),
                "speed_kms": round(n_rads * r_km, 3),
                "source":  "celestrak",
                "propagator": "kepler",
                "tle_line1": line1,
                "tle_line2": line2,
            }
        except Exception:
            return None

    def get_available_groups(self) -> List[Dict]:
        return [
            {"id": "stations",  "label": "Space Stations (ISS, CSS…)"},
            {"id": "starlink",  "label": "Starlink Constellation"},
            {"id": "oneweb",    "label": "OneWeb Constellation"},
            {"id": "last-30-days", "label": "Recent Launches (30 days)"},
            {"id": "cosmos-1408-debris", "label": "COSMOS 1408 Debris Field"},
            {"id": "active",    "label": "All Active Satellites"},
        ]

    def has_sgp4(self) -> bool:
        return _HAS_SGP4


# ── Coordinate helpers ────────────────────────────────────────────────────

def _datetime_to_jd(dt: datetime) -> Tuple[float, float]:
    """Convert datetime to Julian Date (integer + fraction)."""
    # Simple JD formula
    a = (14 - dt.month) // 12
    y = dt.year + 4800 - a
    m = dt.month + 12 * a - 3
    jdn = dt.day + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045
    fr  = (dt.hour + dt.minute / 60 + dt.second / 3600 +
           dt.microsecond / 3.6e9) / 24 - 0.5
    return float(jdn), fr


def _tle_epoch_to_datetime(year: int, day: float) -> datetime:
    """Convert TLE epoch (year + day-of-year) to UTC datetime."""
    import datetime as _dt
    base = _dt.datetime(year, 1, 1, tzinfo=timezone.utc)
    delta = _dt.timedelta(days=day - 1)
    return base + delta


def _eci_to_latlon(r_km, utc_dt: datetime):
    """
    Convert ECI [x,y,z] km to geodetic lat/lon/alt.
    Uses a simple Greenwich sidereal time rotation.
    """
    x, y, z = r_km[0], r_km[1], r_km[2]
    r_xy = math.sqrt(x**2 + y**2)

    # Greenwich Apparent Sidereal Time (simplified)
    jd = _datetime_to_jd(utc_dt)
    jd_total = jd[0] + jd[1]
    T_ut1    = (jd_total - 2451545.0) / 36525.0
    gst_deg  = (280.46061837 + 360.98564736629 * (jd_total - 2451545.0) +
                0.000387933 * T_ut1**2) % 360.0
    gst_rad  = math.radians(gst_deg)

    # Rotate ECI to ECEF
    lon_rad = math.atan2(y, x) - gst_rad
    lon     = math.degrees(lon_rad)
    lon     = ((lon + 180) % 360) - 180   # wrap to [-180, 180]

    r_total = math.sqrt(x**2 + y**2 + z**2)
    lat     = math.degrees(math.asin(z / r_total))
    alt     = r_total - 6371.0

    return lat, lon, alt
