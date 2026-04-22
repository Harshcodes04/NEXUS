"""
═══════════════════════════════════════════════════════════════════════════
 ACM — db_service.py
 SQLite persistence for mission events: CDMs, maneuvers, alerts, fuel.
 Uses Python stdlib sqlite3 — no extra dependencies.
═══════════════════════════════════════════════════════════════════════════
"""

import sqlite3
import json
import os
import threading
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any


DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "data", "mission.db"
)


class DBService:
    """
    Thread-safe SQLite persistence for AutoCM mission events.
    Stores CDMs, maneuvers, alerts, and fuel snapshots.
    """

    _lock = threading.Lock()

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._init_schema()

    # ── Schema Init ───────────────────────────────────────────────────────

    def _init_schema(self):
        """Create tables if they don't exist."""
        with self._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS cdm_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recorded_at TEXT NOT NULL,
                    sim_time    TEXT NOT NULL,
                    satellite_id TEXT NOT NULL,
                    debris_id    TEXT NOT NULL,
                    miss_distance_km REAL NOT NULL,
                    probability      REAL NOT NULL,
                    severity         TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS maneuver_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recorded_at  TEXT NOT NULL,
                    sim_time     TEXT NOT NULL,
                    burn_id      TEXT NOT NULL UNIQUE,
                    satellite_id TEXT NOT NULL,
                    burn_type    TEXT NOT NULL,
                    strategy     TEXT,
                    dv_ms        REAL NOT NULL,
                    fuel_cost_kg REAL NOT NULL,
                    status       TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS alert_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recorded_at  TEXT NOT NULL,
                    sim_time     TEXT NOT NULL,
                    alert_type   TEXT NOT NULL,
                    level        TEXT NOT NULL,
                    message      TEXT NOT NULL,
                    satellite_id TEXT
                );

                CREATE TABLE IF NOT EXISTS fuel_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recorded_at  TEXT NOT NULL,
                    sim_time     TEXT NOT NULL,
                    satellite_id TEXT NOT NULL,
                    fuel_kg      REAL NOT NULL,
                    status       TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_cdm_sat    ON cdm_events(satellite_id);
                CREATE INDEX IF NOT EXISTS idx_cdm_sim    ON cdm_events(sim_time);
                CREATE INDEX IF NOT EXISTS idx_man_sat    ON maneuver_events(satellite_id);
                CREATE INDEX IF NOT EXISTS idx_alert_sat  ON alert_events(satellite_id);
                CREATE INDEX IF NOT EXISTS idx_fuel_sat   ON fuel_snapshots(satellite_id);
                CREATE INDEX IF NOT EXISTS idx_fuel_sim   ON fuel_snapshots(sim_time);
            """)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    # ── Write Methods ─────────────────────────────────────────────────────

    def record_cdm(self, sim_time: str, satellite_id: str, debris_id: str,
                   miss_distance_km: float, probability: float, severity: str):
        """Persist a CDM detection event."""
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as conn:
            conn.execute("""
                INSERT INTO cdm_events
                  (recorded_at, sim_time, satellite_id, debris_id, miss_distance_km, probability, severity)
                VALUES (?,?,?,?,?,?,?)
            """, (now, sim_time, satellite_id, debris_id, miss_distance_km, probability, severity))

    def record_maneuver(self, sim_time: str, burn_id: str, satellite_id: str,
                        burn_type: str, strategy: Optional[str], dv_ms: float,
                        fuel_cost_kg: float, status: str = "EXECUTED"):
        """Persist a maneuver execution event."""
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as conn:
            conn.execute("""
                INSERT OR IGNORE INTO maneuver_events
                  (recorded_at, sim_time, burn_id, satellite_id, burn_type, strategy, dv_ms, fuel_cost_kg, status)
                VALUES (?,?,?,?,?,?,?,?,?)
            """, (now, sim_time, burn_id, satellite_id, burn_type, strategy, dv_ms, fuel_cost_kg, status))

    def record_alert(self, sim_time: str, alert_type: str, level: str,
                     message: str, satellite_id: Optional[str] = None):
        """Persist a mission alert."""
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as conn:
            conn.execute("""
                INSERT INTO alert_events
                  (recorded_at, sim_time, alert_type, level, message, satellite_id)
                VALUES (?,?,?,?,?,?)
            """, (now, sim_time, alert_type, level, message, satellite_id))

    def record_fuel_snapshot(self, sim_time: str, satellite_id: str,
                              fuel_kg: float, status: str):
        """Persist a fuel snapshot (called periodically)."""
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as conn:
            conn.execute("""
                INSERT INTO fuel_snapshots
                  (recorded_at, sim_time, satellite_id, fuel_kg, status)
                VALUES (?,?,?,?,?)
            """, (now, sim_time, satellite_id, fuel_kg, status))

    # ── Read Methods ──────────────────────────────────────────────────────

    def get_cdm_history(self, limit: int = 100, satellite_id: Optional[str] = None) -> List[Dict]:
        """Get recent CDM events."""
        with self._connect() as conn:
            if satellite_id:
                rows = conn.execute("""
                    SELECT * FROM cdm_events WHERE satellite_id=?
                    ORDER BY id DESC LIMIT ?
                """, (satellite_id, limit)).fetchall()
            else:
                rows = conn.execute("""
                    SELECT * FROM cdm_events ORDER BY id DESC LIMIT ?
                """, (limit,)).fetchall()
        return [dict(r) for r in rows]

    def get_maneuver_history(self, limit: int = 100, satellite_id: Optional[str] = None) -> List[Dict]:
        """Get recent maneuver events."""
        with self._connect() as conn:
            if satellite_id:
                rows = conn.execute("""
                    SELECT * FROM maneuver_events WHERE satellite_id=?
                    ORDER BY id DESC LIMIT ?
                """, (satellite_id, limit)).fetchall()
            else:
                rows = conn.execute("""
                    SELECT * FROM maneuver_events ORDER BY id DESC LIMIT ?
                """, (limit,)).fetchall()
        return [dict(r) for r in rows]

    def get_alert_history(self, limit: int = 200) -> List[Dict]:
        """Get recent alerts."""
        with self._connect() as conn:
            rows = conn.execute("""
                SELECT * FROM alert_events ORDER BY id DESC LIMIT ?
            """, (limit,)).fetchall()
        return [dict(r) for r in rows]

    def get_fuel_timeline(self, satellite_id: str, limit: int = 500) -> List[Dict]:
        """Get fuel usage timeline for a satellite."""
        with self._connect() as conn:
            rows = conn.execute("""
                SELECT * FROM fuel_snapshots WHERE satellite_id=?
                ORDER BY id ASC LIMIT ?
            """, (satellite_id, limit)).fetchall()
        return [dict(r) for r in rows]

    def get_fleet_summary(self) -> Dict:
        """Aggregate summary stats across all time."""
        with self._connect() as conn:
            total_cdms    = conn.execute("SELECT COUNT(*) FROM cdm_events").fetchone()[0]
            critical_cdms = conn.execute(
                "SELECT COUNT(*) FROM cdm_events WHERE severity='CRITICAL'"
            ).fetchone()[0]
            total_burns   = conn.execute("SELECT COUNT(*) FROM maneuver_events").fetchone()[0]
            total_dv      = conn.execute("SELECT SUM(dv_ms) FROM maneuver_events").fetchone()[0] or 0.0
            total_fuel    = conn.execute("SELECT SUM(fuel_cost_kg) FROM maneuver_events").fetchone()[0] or 0.0
            total_alerts  = conn.execute("SELECT COUNT(*) FROM alert_events").fetchone()[0]
            evasions      = conn.execute(
                "SELECT COUNT(*) FROM maneuver_events WHERE burn_type='EVASION BURN'"
            ).fetchone()[0]

            # CDMs per satellite
            per_sat = conn.execute("""
                SELECT satellite_id, COUNT(*) as cdm_count,
                       MIN(miss_distance_km) as closest_km,
                       AVG(miss_distance_km) as avg_km
                FROM cdm_events GROUP BY satellite_id ORDER BY cdm_count DESC
            """).fetchall()

            # Maneuvers per satellite  
            burns_per_sat = conn.execute("""
                SELECT satellite_id, COUNT(*) as burn_count,
                       SUM(dv_ms) as total_dv, SUM(fuel_cost_kg) as total_fuel
                FROM maneuver_events GROUP BY satellite_id ORDER BY burn_count DESC
            """).fetchall()

            # CDMs over time (grouped by day/hour bucket)
            cdm_over_time = conn.execute("""
                SELECT substr(sim_time,1,13) as hour_bucket, COUNT(*) as count,
                       MIN(miss_distance_km) as min_miss
                FROM cdm_events GROUP BY hour_bucket ORDER BY hour_bucket ASC LIMIT 100
            """).fetchall()

        return {
            "totals": {
                "cdms": total_cdms,
                "critical_cdms": critical_cdms,
                "maneuvers": total_burns,
                "evasions": evasions,
                "total_dv_ms": round(total_dv, 2),
                "total_fuel_kg": round(total_fuel, 4),
                "alerts": total_alerts,
            },
            "per_satellite_cdms": [dict(r) for r in per_sat],
            "per_satellite_burns": [dict(r) for r in burns_per_sat],
            "cdm_over_time": [dict(r) for r in cdm_over_time],
        }

    def get_satellite_lifetime(self, satellite_id: str) -> Dict:
        """Full lifetime statistics for a single satellite."""
        with self._connect() as conn:
            cdms = conn.execute(
                "SELECT COUNT(*) FROM cdm_events WHERE satellite_id=?", (satellite_id,)
            ).fetchone()[0]
            closest = conn.execute(
                "SELECT MIN(miss_distance_km) FROM cdm_events WHERE satellite_id=?", (satellite_id,)
            ).fetchone()[0]
            burns = conn.execute(
                "SELECT COUNT(*) FROM maneuver_events WHERE satellite_id=?", (satellite_id,)
            ).fetchone()[0]
            dv = conn.execute(
                "SELECT SUM(dv_ms) FROM maneuver_events WHERE satellite_id=?", (satellite_id,)
            ).fetchone()[0] or 0.0
            fuel = conn.execute(
                "SELECT SUM(fuel_cost_kg) FROM maneuver_events WHERE satellite_id=?", (satellite_id,)
            ).fetchone()[0] or 0.0
            fuel_history = conn.execute("""
                SELECT sim_time, fuel_kg FROM fuel_snapshots
                WHERE satellite_id=? ORDER BY id ASC LIMIT 200
            """, (satellite_id,)).fetchall()

        return {
            "satellite_id": satellite_id,
            "total_cdms": cdms,
            "closest_approach_km": closest,
            "total_burns": burns,
            "total_dv_ms": round(dv, 2),
            "total_fuel_burned_kg": round(fuel, 4),
            "fuel_timeline": [{"t": r[0], "fuel_kg": r[1]} for r in fuel_history],
        }
