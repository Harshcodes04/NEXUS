"""
Verification Test Suite - test_v2_features.py
Verifies exponential uptime scoring and high-fidelity nominal slot propagation.
"""

import sys
import os
import pytest
import numpy as np
from datetime import datetime, timezone, timedelta

# Ensure API is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from api.state_manager import state
from api.models import Vector3, Satellite

def test_exponential_uptime_decay():
    """Verify that uptime score decays exponentially when off-station."""
    state.reset()
    sat_id = "DECAY-SAT"
    
    # 1. Add satellite at nominal position
    sat = Satellite(
        id=sat_id,
        r=Vector3(x=7000.0, y=0.0, z=0.0),
        v=Vector3(x=0.0, y=7.5, z=0.0),
        fuel_kg=50.0,
        uptime_score=1.0,
        is_nominal=True
    )
    state.fleet.add_satellite(sat)
    
    # 2. Force it off-station (out of 10km box)
    sat.r.x += 15.0 
    
    # 3. Simulate 3600 seconds (1 hour)
    # Predicted score: e^(-0.0001925 * 3600) ~= 0.50
    state.simulate_step(3600)
    
    final_score = state.fleet.satellites[sat_id].uptime_score
    print(f"Score after 1h outage: {final_score:.4f}")
    
    assert 0.49 < final_score < 0.51
    assert len(state.fleet.satellites[sat_id].outage_events) > 0

def test_rk4_nominal_slot_consistency():
    """Verify that the unperturbed nominal slot uses high-fidelity RK4."""
    state.reset()
    sat_id = "RK4-SAT"
    
    # Add sat
    sat = Satellite(
        id=sat_id,
        r=Vector3(x=7000.0, y=0.0, z=0.0),
        v=Vector3(x=0.0, y=7.5, z=0.0)
    )
    state.fleet.add_satellite(sat)
    
    # Initial energy of nominal slot
    from api.core.physics import MU
    r0 = sat.nominal_r.to_np()
    v0 = sat.nominal_v.to_np()
    E0 = 0.5 * np.dot(v0, v0) - MU / np.linalg.norm(r0)
    
    # Propagate 1 day (86400s)
    state.simulate_step(86400)
    
    # Final energy of nominal slot
    r1 = sat.nominal_r.to_np()
    v1 = sat.nominal_v.to_np()
    E1 = 0.5 * np.dot(v1, v1) - MU / np.linalg.norm(r1)
    
    energy_error = abs((E1 - E0) / E0)
    print(f"Nominal Slot Energy Error (1 day): {energy_error:.2e}")
    
    # RK4 should maintain energy to < 1e-5 for unperturbed motion over 24 hours
    # (Cumulative error for 1440 steps of 60s each)
    assert energy_error < 1e-5

def test_alert_callback_integration():
    """Verify that DecisionService triggers alerts via StateManager callback."""
    state.reset()
    sat_id = "ALERT-SAT"
    
    # Add sat with low fuel
    sat = Satellite(
        id=sat_id,
        r=Vector3(x=7000.0, y=0.0, z=0.0),
        v=Vector3(x=0.0, y=7.5, z=0.0),
        fuel_kg=2.0 # < 2.5kg threshold
    )
    state.fleet.add_satellite(sat)
    
    # Trigger decision logic
    state.decision.process_cdms([], state.sim_time)
    
    # Check for alert in StateManager
    alerts = state.get_alerts_since(0)
    assert any("EOL_ALERT" in a['type'] for a in alerts)
    assert any(sat_id in a['message'] for a in alerts)

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
