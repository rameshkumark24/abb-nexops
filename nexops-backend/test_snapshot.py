"""
Integration tests for the GET /telemetry/snapshot endpoint.
Verify scoping (plant_manager gets all; zone managers get only their zone's machines)
and authentication (401 when no token is present).
"""

import os
import pytest

# Point to throwaway DB before importing main/db
os.environ["DATABASE_URL"] = "sqlite:///./test_snapshot_tmp.db"

from fastapi.testclient import TestClient
import main
from seed import seed
from db import init_db

client = TestClient(main.app)
PASSWORD = "nexops123"

def setup_module(module):
    """Seed the DB for user logins."""
    init_db()
    seed()

def _login(username):
    r = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200
    return r.json()["token"]

def _auth(token):
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture(autouse=True)
def populate_cache():
    """Clear and fill main.latest_machine_states with known dummy records."""
    main.latest_machine_states.clear()
    main.latest_machine_states.update({
        "Compressor A1": {
            "Machine": "Compressor A1",
            "zone": "A",
            "Status": "Normal",
            "Timestamp": "2026-06-18 12:00:00"
        },
        "Heat Exchanger B1": {
            "Machine": "Heat Exchanger B1",
            "zone": "B",
            "Status": "Warning",
            "Timestamp": "2026-06-18 12:01:00"
        },
        "Separator B2": {
            "Machine": "Separator B2",
            "zone": "B",
            "Status": "Normal",
            "Timestamp": "2026-06-18 12:02:00"
        },
        "Boiler C1": {
            "Machine": "Boiler C1",
            "zone": "C",
            "Status": "Critical",
            "Timestamp": "2026-06-18 12:03:00"
        },
        "Reactor D1": {
            "Machine": "Reactor D1",
            "zone": "D",
            "Status": "Normal",
            "Timestamp": "2026-06-18 12:04:00"
        },
        # Machine with implicit zone (falls back to A based on name)
        "Pump A2": {
            "Machine": "Pump A2",
            "Status": "Normal",
            "Timestamp": "2026-06-18 12:05:00"
        }
    })
    yield
    main.latest_machine_states.clear()

def test_unauthenticated_snapshot_401():
    r = client.get("/telemetry/snapshot")
    assert r.status_code == 401

def test_plant_manager_sees_all_machines():
    tok = _login("plant")
    r = client.get("/telemetry/snapshot", headers=_auth(tok))
    assert r.status_code == 200
    records = r.json()
    assert len(records) == 6
    machines = {rec["Machine"] for rec in records}
    assert "Compressor A1" in machines
    assert "Boiler C1" in machines
    assert "Pump A2" in machines

def test_field_manager_b_sees_only_zone_b():
    tok = _login("fieldB")
    r = client.get("/telemetry/snapshot", headers=_auth(tok))
    assert r.status_code == 200
    records = r.json()
    assert len(records) == 2
    machines = {rec["Machine"] for rec in records}
    assert machines == {"Heat Exchanger B1", "Separator B2"}

def test_field_manager_c_sees_only_zone_c():
    tok = _login("fieldC")
    r = client.get("/telemetry/snapshot", headers=_auth(tok))
    assert r.status_code == 200
    records = r.json()
    assert len(records) == 1
    assert records[0]["Machine"] == "Boiler C1"

def test_field_manager_a_sees_implicit_zone_a():
    tok = _login("fieldA")
    r = client.get("/telemetry/snapshot", headers=_auth(tok))
    assert r.status_code == 200
    records = r.json()
    assert len(records) == 2
    machines = {rec["Machine"] for rec in records}
    assert machines == {"Compressor A1", "Pump A2"}
