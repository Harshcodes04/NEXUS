"""
═══════════════════════════════════════════════════════════════════════════
 AutoCM Compliance Test Suite — test_compliance.py 
 National Space Hackathon 2026
═══════════════════════════════════════════════════════════════════════════
"""

import sys
import os
import pytest
import math
import numpy as np
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

# Ensure API is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from api.main import app
from api.state_manager import state
from api.models import Vector3

@pytest.fixture(scope="function")
def client():
    """Provides a fresh simulation state for each test."""
    state.reset()
    with TestClient(app) as c:
        yield c

class TestPhysicsCompliance:
    """Section 3: Physics, Coordinate Systems, and Orbital Mechanics."""

    def test_j2_acceleration_components(self, client):
        """Verify J2 acceleration impacts nodal regression (Section 3.2)."""
        from api.core.physics import J2RK4Propagator
        prop = J2RK4Propagator()
        
        # Position with Z component (required for J2 effect)
        r = np.array([5000.0, 5000.0, 1000.0])
        a_total = prop.get_accelerations(r, including_j2=True)
        a_2body = prop.get_accelerations(r, including_j2=False)
        
        a_j2 = a_total - a_2body
        
        # J2 acceleration at Z=1000km should have a non-zero Z component
        assert abs(a_j2[2]) > 0
        assert np.linalg.norm(a_j2) < np.linalg.norm(a_2body) # Perturbation is small

    def test_rk4_step_integration(self, client):
        """Verify RK4 maintains bound orbit energy over one step (Section 3.2)."""
        from api.core.physics import J2RK4Propagator, MU
        prop = J2RK4Propagator()
        
        r = np.array([6878.0, 0.0, 0.0])
        v = np.array([0.0, 7.6, 0.0])
        
        energy_initial = 0.5 * np.dot(v, v) - MU / np.linalg.norm(r)
        
        r_next, v_next = prop.propagate(r, v, 60.0)
        energy_final = 0.5 * np.dot(v_next, v_next) - MU / np.linalg.norm(r_next)
        
        # Energy should be conserved in unperturbed or nearly conserved with J2
        assert abs((energy_final - energy_initial) / energy_initial) < 1e-6

class TestAPICompliance:
    """Section 4: API Specifications and Constraints."""

    def test_telemetry_ingestion_ack(self, client):
        """Verify POST /api/telemetry returns ACK (Section 4.1)."""
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "objects": [{
                "id": "SAT-TEST-001",
                "type": "SATELLITE",
                "r": {"x": 1356.1, "y": 5930.5, "z": 3302.3},
                "v": {"x": -6.5, "y": 1.5, "z": 3.4}
            }]
        }
        res = client.post("/api/telemetry", json=payload)
        assert res.status_code == 200
        assert res.json()["status"] == "ACK"

    def test_signal_latency_enforcement(self, client):
        """Verify 10s latency rejection for schedule (Section 5.4)."""
        # Attempt to schedule a burn 5 seconds from now
        sim_now = state.sim_time
        burn_time = sim_now + timedelta(seconds=5)
        
        # Ensure satellite exists
        client.post("/api/telemetry", json={
            "timestamp": sim_now.isoformat(),
            "objects": [{"id": "LATENCY-SAT", "type": "SATELLITE", "r": {"x": 7000, "y": 0, "z": 0}, "v": {"x": 0, "y": 7.5, "z": 0}}]
        })
        
        payload = {
            "satelliteId": "LATENCY-SAT",
            "maneuver_sequence": [{
                "burn_id": "LATE-BURN",
                "burnTime": burn_time.isoformat(),
                "deltaV_vector": {"x": 1.0, "y": 0.0, "z": 0.0}
            }]
        }
        res = client.post("/api/maneuver/schedule", json=payload)
        assert res.json()["status"] == "REJECTED"
        assert "latency" in res.json()["failed_burns"][0]["error"]

class TestManeuverCompliance:
    """Section 5: Detailed Maneuver & Navigation Logic."""

    def test_thrust_limit_enforcement(self, client):
        """Verify 15.0 m/s thrust limit is enforced (Section 5.1)."""
        sat_id = "THRUST-SAT"
        client.post("/api/telemetry", json={
            "timestamp": state.sim_time.isoformat(),
            "objects": [{"id": sat_id, "type": "SATELLITE", "r": {"x": 7000, "y": 0, "z": 0}, "v": {"x": 0, "y": 7.5, "z": 0}}]
        })
        
        # Attempt to schedule burn with 20.0 m/s (exceeds 15.0 m/s limit)
        payload = {
            "satelliteId": sat_id,
            "maneuver_sequence": [{
                "burn_id": "THRUST-OVER",
                "burnTime": (state.sim_time + timedelta(seconds=20)).isoformat(),
                "deltaV_vector": {"x": 20.0, "y": 0, "z": 0}
            }]
        }
        res = client.post("/api/maneuver/schedule", json=payload)
        assert res.json()["status"] == "REJECTED"
        assert "thrust limit" in res.json()["failed_burns"][0]["error"].lower()

    def test_tsiolkovsky_fuel_deduction(self, client):
        """Verify fuel depletion via rocket equation (Section 5.1)."""
        sat_id = "FUEL-SAT"
        from api.models import Satellite
        from api.core.physics import latlon_to_eci
        # Place satellite directly over Bengaluru ground station at simulation start
        r_eci_np = latlon_to_eci(13.0, 77.5, 600.0, state.sim_time)
        
        state.fleet.add_satellite(Satellite(
            id=sat_id, 
            r=Vector3.from_np(r_eci_np), 
            v=Vector3(x=-7.5, y=0.5, z=0.0),
            fuel_kg=50.0
        ))
        
        # 10 m/s burn
        dv_mag = 10.0
        m_initial = 550.0 # dry + fuel
        isp = 300.0
        g0 = 9.80665
        expected_fuel_consumed = m_initial * (1 - math.exp(-dv_mag / (isp * g0)))
        
        payload = {
            "satelliteId": sat_id,
            "maneuver_sequence": [{
                "burn_id": "B1",
                "burnTime": (state.sim_time + timedelta(seconds=20)).isoformat(),
                "deltaV_vector": {"x": dv_mag, "y": 0, "z": 0}
            }]
        }
        res = client.post("/api/maneuver/schedule", json=payload)
        assert res.json()["status"] == "SCHEDULED", f"Maneuver rejected: {res.json().get('failed_burns')}"
        
        client.post("/api/simulate/step", json={"step_seconds": 60})
        
        sat = state.fleet.satellites[sat_id]
        assert abs(sat.fuel_kg - (50.0 - expected_fuel_consumed)) < 0.05

    def test_station_keeping_drift_detection(self, client):
        """Verify 10km drift triggers OFF_STATION status (Section 5.2)."""
        sat_id = "DRIFT-SAT"
        # Seed sat
        client.post("/api/telemetry", json={
            "timestamp": state.sim_time.isoformat(),
            "objects": [{"id": sat_id, "type": "SATELLITE", "r": {"x": 7000, "y": 0, "z": 0}, "v": {"x": 0, "y": 7.5, "z": 0}}]
        })
        
        # Immediate 20 km drift maneuver (manual override via state to force it)
        sat = state.fleet.satellites[sat_id]
        sat.r.x += 11.0 # Exceed 10km radius
        
        # Step to trigger check
        client.post("/api/simulate/step", json={"step_seconds": 1})
        
        assert not sat.is_nominal
        assert sat.status == "OFF_STATION"

class TestAutonomyCompliance:
    """Section 2: Autonomous Evasion & Recovery."""

    def test_autonomous_evasion_recovery_pairing(self, client):
        """Verify evasion triggers a paired recovery burn (Section 5.2)."""
        # Inject critical CDM
        sat_id = "AUTO-SAT"
        client.post("/api/telemetry", json={
            "timestamp": state.sim_time.isoformat(),
            "objects": [{"id": sat_id, "type": "SATELLITE", "r": {"x": 7000, "y": 0, "z": 0}, "v": {"x": 0, "y": 7.5, "z": 0}}]
        })
        
        from api.models import CDM
        tca = state.sim_time + timedelta(minutes=45)
        cdm = CDM(satelliteId=sat_id, debrisId="DEB-999", tca=tca, missDistance=0.05, probability=0.5)
        
        # Trigger decision logic
        state.decision.process_cdms([cdm], state.sim_time)
        
        # Verify two burns scheduled (EVA + REC)
        burns = state.maneuver.scheduled_burns.get(sat_id, [])
        assert len(burns) == 2
        assert any("EVA" in b.burn_id for b in burns)
        assert any("REC" in b.burn_id for b in burns)

    def test_eol_graveyard_maneuver(self, client):
        """Verify fuel < 5% triggers EOL graveyard maneuver (Section 5.1/2)."""
        sat_id = "EOL-SAT"
        client.post("/api/telemetry", json={
            "timestamp": state.sim_time.isoformat(),
            "objects": [{"id": sat_id, "type": "SATELLITE", "r": {"x": 7000, "y": 0, "z": 0}, "v": {"x": 0, "y": 7.5, "z": 0}}]
        })
        
        # Drain fuel to 4%
        sat = state.fleet.satellites[sat_id]
        sat.fuel_kg = 2.0 
        
        # Decision logic check
        state.decision.process_cdms([], state.sim_time)
        
        assert sat.status == "EOL"
        assert any("GRAVEYARD" in b.burn_id for b in state.maneuver.scheduled_burns.get(sat_id, []))

    def test_blackout_queueing(self, client):
        """Verify burns are queued during blackout and uploaded when LOS available (Section 5.4)."""
        sat_id = "QUEUE-SAT"
        from api.models import Satellite
        from api.core.physics import latlon_to_eci
        # Place satellite far from ground stations to simulate blackout
        r_eci_np = latlon_to_eci(0.0, 0.0, 600.0, state.sim_time)
        
        state.fleet.add_satellite(Satellite(
            id=sat_id, 
            r=Vector3.from_np(r_eci_np), 
            v=Vector3(x=-7.5, y=0.5, z=0.0),
            fuel_kg=50.0
        ))
        
        # Schedule burn during blackout - should be queued
        payload = {
            "satelliteId": sat_id,
            "maneuver_sequence": [{
                "burn_id": "QUEUE-BURN",
                "burnTime": (state.sim_time + timedelta(seconds=60)).isoformat(),
                "deltaV_vector": {"x": 5.0, "y": 0, "z": 0}
            }]
        }
        res = client.post("/api/maneuver/schedule", json=payload)
        # Should be scheduled (queued) even without LOS
        assert res.json()["status"] == "SCHEDULED"
        # Verify burn is in pending queue
        assert len(state.maneuver.pending_upload_queue.get(sat_id, [])) > 0

    def test_station_keeping_correction(self, client):
        """Verify station-keeping RTN corrections are scheduled when drift > 5km (Section 5.2)."""
        sat_id = "SK-SAT"
        from api.models import Satellite
        from api.core.physics import latlon_to_eci
        r_eci_np = latlon_to_eci(13.0, 77.5, 600.0, state.sim_time)
        
        state.fleet.add_satellite(Satellite(
            id=sat_id, 
            r=Vector3.from_np(r_eci_np), 
            v=Vector3(x=-7.5, y=0.5, z=0.0),
            fuel_kg=50.0
        ))
        
        # Force satellite drift > 5km from nominal slot
        sat = state.fleet.satellites[sat_id]
        sat.r.x += 6.0  # 6km drift exceeds 5km threshold
        
        # Trigger station-keeping check
        sk_actions = state.decision.check_station_keeping([sat], state.sim_time)
        
        # Verify station-keeping correction was scheduled
        assert len(sk_actions) > 0
        assert sk_actions[0]["type"] == "STATION_KEEPING_CORRECTION"
        assert sk_actions[0]["drift_km"] > 5.0

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
