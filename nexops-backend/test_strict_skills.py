import pytest
from db import get_session, Engineer, Assignment
from seed import seed
from assignment import assign_engineer

def setup_module(module):
    """Seed the database with the standard 16-engineer roster."""
    seed()

def _sample_fault(category, zone="A"):
    """Generate a sample fault record for a given category."""
    mapping = {
        "mechanical": {
            "alarm_id": 8001, "Machine": "Pump A", "zone": zone,
            "alarm_type": "Predictive", "Alert": "Vibration High",
            "message": "mechanical wear developing on bearing"
        },
        "electrical": {
            "alarm_id": 8002, "Machine": "Motor A", "zone": zone,
            "alarm_type": "Electrical", "Alert": "Overcurrent",
            "message": "electrical windings short circuit"
        },
        "thermal": {
            "alarm_id": 8003, "Machine": "Heater A", "zone": zone,
            "alarm_type": "Process", "Alert": "High Temp",
            "message": "heat thermal related issue detected"
        },
        "hydraulic": {
            "alarm_id": 8004, "Machine": "Valve A", "zone": zone,
            "alarm_type": "Process", "Alert": "Pressure Drop",
            "message": "hydraulic actuator fluid leaking"
        },
        "general": {
            "alarm_id": 8005, "Machine": "Panel A", "zone": zone,
            "alarm_type": "System", "Alert": "General",
            "message": "general status notice"
        }
    }
    return mapping[category]

def test_thermal_fault_only_to_thermal():
    session = get_session()
    try:
        fault = _sample_fault("thermal", "A")
        res = assign_engineer(fault, session)
        assert res["assigned"] is True
        eng = session.get(Engineer, res["engineer_id"])
        assert "thermal" in (eng.skills or [])
    finally:
        session.close()

def test_mechanical_fault_only_to_mechanical():
    session = get_session()
    try:
        fault = _sample_fault("mechanical", "A")
        res = assign_engineer(fault, session)
        assert res["assigned"] is True
        eng = session.get(Engineer, res["engineer_id"])
        assert "mechanical" in (eng.skills or [])
    finally:
        session.close()

def test_electrical_fault_only_to_electrical():
    session = get_session()
    try:
        fault = _sample_fault("electrical", "A")
        res = assign_engineer(fault, session)
        assert res["assigned"] is True
        eng = session.get(Engineer, res["engineer_id"])
        assert "electrical" in (eng.skills or [])
    finally:
        session.close()

def test_hydraulic_fault_only_to_hydraulic():
    session = get_session()
    try:
        fault = _sample_fault("hydraulic", "D") # Zone D has Mara (hydraulic specialist)
        res = assign_engineer(fault, session)
        assert res["assigned"] is True
        eng = session.get(Engineer, res["engineer_id"])
        assert "hydraulic" in (eng.skills or [])
    finally:
        session.close()

def test_no_matching_skill_leaves_unassigned():
    session = get_session()
    try:
        # Deactivate or put at capacity all mechanical engineers in the roster
        # Mechanical engineers are: Ravi Kumar (id=1), Boris Petrov (id=5), Chen Wei (id=9), Yuki Tanaka (id=10), Liam O'Brien (id=14)
        # Also deactivate Lena Vogel (id=3, generalist with mechanical skill)
        for eid in (1, 3, 5, 9, 10, 14):
            eng = session.get(Engineer, eid)
            eng.active = False
        session.commit()

        fault = _sample_fault("mechanical", "A")
        res = assign_engineer(fault, session)
        # Since all mechanical engineers are deactivated/unavailable, it must remain unassigned
        assert res["assigned"] is False
        assert res["engineer_id"] is None
        assert "UNASSIGNED" in res["reasoning"]
    finally:
        # Clean up by reseeding
        seed()
        session.close()
