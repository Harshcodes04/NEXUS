#!/usr/bin/env python3
"""
Generate AutoCM catalog with 100 satellites and 5000 debris objects.
Uses deterministic random number generation for reproducibility.
"""

import json
import random
import math
from datetime import datetime

# Physics constants
MU = 398600.4418  # km³/s²
RE = 6378.137     # km

# Set random seed for reproducibility
random.seed(42)

def generate_leo_state(altitude_km, inclination_deg=None, eccentricity=0.001):
    """Generate a physically plausible LEO state vector."""
    
    # Altitude range
    if inclination_deg is None:
        inclination_deg = random.uniform(45, 98)  # Avoid sun-synchronous for variety
    
    # Orbital parameters
    semi_major_axis = RE + altitude_km
    
    # Circular-ish orbit velocity
    v_circular = math.sqrt(MU / semi_major_axis)
    
    # Add small eccentricity variation
    v_magnitude = v_circular * (1 + random.uniform(-0.01, 0.01))
    
    # Random position in orbit
    true_anomaly = random.uniform(0, 2 * math.pi)
    
    # Position in orbital plane
    r_orbital = semi_major_axis * (1 - eccentricity * math.cos(true_anomaly))
    x_orbital = r_orbital * math.cos(true_anomaly)
    y_orbital = r_orbital * math.sin(true_anomaly)
    
    # Velocity in orbital plane
    vx_orbital = -v_magnitude * math.sin(true_anomaly)
    vy_orbital = v_magnitude * (math.cos(true_anomaly) + eccentricity)
    
    # Convert to ECI using rotation matrices
    inc_rad = math.radians(inclination_deg)
    raan = random.uniform(0, 2 * math.pi)
    argp = random.uniform(0, 2 * math.pi)
    
    # Rotation matrices
    cos_raan, sin_raan = math.cos(raan), math.sin(raan)
    cos_inc, sin_inc = math.cos(inc_rad), math.sin(inc_rad)
    cos_argp, sin_argp = math.cos(argp), math.sin(argp)
    
    # Combined rotation (RAAN -> inclination -> argument of periapsis)
    R11 = cos_raan * cos_argp - sin_raan * sin_argp * cos_inc
    R12 = -cos_raan * sin_argp - sin_raan * cos_argp * cos_inc
    R13 = sin_raan * sin_inc
    
    R21 = sin_raan * cos_argp + cos_raan * sin_argp * cos_inc
    R22 = -sin_raan * sin_argp + cos_raan * cos_argp * cos_inc
    R23 = -cos_raan * sin_inc
    
    R31 = sin_argp * sin_inc
    R32 = cos_argp * sin_inc
    R33 = cos_inc
    
    # Transform to ECI
    x = R11 * x_orbital + R12 * y_orbital
    y = R21 * x_orbital + R22 * y_orbital
    z = R31 * x_orbital + R32 * y_orbital
    
    vx = R11 * vx_orbital + R12 * vy_orbital
    vy = R21 * vx_orbital + R22 * vy_orbital
    vz = R31 * vx_orbital + R32 * vy_orbital
    
    # Random epoch within 1 day of J2000
    epoch = random.uniform(0, 86400)
    
    return {
        "t": epoch,
        "r": {"x": x, "y": y, "z": z},
        "v": {"x": vx, "y": vy, "z": vz}
    }

def generate_satellites():
    """Generate 100 satellites with IDs SAT-Alpha-01 through SAT-Beta-50."""
    satellites = []
    
    # Alpha series (50 satellites)
    for i in range(1, 51):
        sat_id = f"SAT-Alpha-{i:02d}"
        state = generate_leo_state(random.uniform(450, 600))
        
        satellite = {
            "id": sat_id,
            "type": "SATELLITE",
            "state": state,
            "mass_dry": 500.0,
            "mass_fuel": 50.0,
            "controllable": True,
            "nominal_slot": state  # Reference unperturbed orbit
        }
        satellites.append(satellite)
    
    # Beta series (50 satellites)
    for i in range(1, 51):
        sat_id = f"SAT-Beta-{i:02d}"
        state = generate_leo_state(random.uniform(450, 600))
        
        satellite = {
            "id": sat_id,
            "type": "SATELLITE",
            "state": state,
            "mass_dry": 500.0,
            "mass_fuel": 50.0,
            "controllable": True,
            "nominal_slot": state  # Reference unperturbed orbit
        }
        satellites.append(satellite)
    
    return satellites

def generate_debris():
    """Generate 5000 debris objects with IDs DEB-00001 through DEB-05000."""
    debris = []
    
    for i in range(1, 5001):
        deb_id = f"DEB-{i:05d}"
        state = generate_leo_state(random.uniform(400, 650))
        
        debris_obj = {
            "id": deb_id,
            "type": "DEBRIS",
            "state": state,
            "mass_dry": 0.0,
            "mass_fuel": 0.0,
            "controllable": False
        }
        debris.append(debris_obj)
    
    return debris

def main():
    """Generate the complete catalog."""
    print("Generating AutoCM catalog...")
    
    satellites = generate_satellites()
    debris = generate_debris()
    
    catalog = {
        "satellites": satellites,
        "debris": debris,
        "metadata": {
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "num_satellites": len(satellites),
            "num_debris": len(debris),
            "total_objects": len(satellites) + len(debris)
        }
    }
    
    # Write to file
    with open("catalog.json", "w") as f:
        json.dump(catalog, f, indent=2)
    
    print(f"Generated catalog with {len(satellites)} satellites and {len(debris)} debris objects")
    print("Catalog saved to catalog.json")

if __name__ == "__main__":
    main()
