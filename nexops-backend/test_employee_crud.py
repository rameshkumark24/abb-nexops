"""
Stage 3d — plant-manager employee management tests.

Covers: create technician (Engineer + linked User, one transaction), soft-delete
(deactivate/activate) and its effect on ASSIGNMENT ELIGIBILITY, plant-only
enforcement, and validation/fail-safe codes.

ISOLATION: points DATABASE_URL at a throwaway SQLite file BEFORE any project
import (real demo DB untouched). TestClient built WITHOUT its `with` context, so
startup/shutdown (MQTT connect) never fire — HTTP surface only. assign_engineer
is exercised directly against the same temp DB to prove eligibility.

Run:  pytest test_employee_crud.py      (do NOT run as part of this task)
"""

import os

# MUST precede project imports: db.py reads DATABASE_URL at import time.
os.environ["DATABASE_URL"] = "sqlite:///./test_employee_tmp.db"

from fastapi.testclient import TestClient

import main
from db import Engineer, User, get_session
from seed import seed, DEV_PASSWORD
from assignment import assign_engineer

client = TestClient(main.app)


def setup_module(module):
    """Wipe+reseed (16 engineers w/ active=True + 21 users) into the throwaway DB."""
    seed()


# ---- helpers ----------------------------------------------------------

def _login(username, password=DEV_PASSWORD):
    return client.post("/auth/login", json={"username": username, "password": password})


def _token(username, password=DEV_PASSWORD):
    r = _login(username, password)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _mech_record(zone="A"):
    """A non-critical MECHANICAL fault record in the given zone."""
    return {
        "Machine": f"Pump-{zone}",
        "zone": zone,
        "alarm_type": "Process",
        "alarm_priority": "Medium",
        "Status": "Warning",
        "Alert": "Vibration",
        "message": "bearing vibration trending high",
    }


def _candidate_ids(record):
    session = get_session()
    try:
        res = assign_engineer(record, session)
        return {c["engineer_id"] for c in res.get("candidates", [])}
    finally:
        session.close()


# ---- (a) plant creates engineer+user; login with new creds works -------

def test_a_plant_create_engineer_and_login():
    tok = _token("plant")
    r = client.post(
        "/engineers",
        headers=_auth(tok),
        json={"name": "Nadia Brooks", "zone": "A", "skills": ["mechanical"]},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["engineer"]["active"] is True
    uname = body["user"]["username"]
    assert body["user"]["role"] == "technician"
    assert body["user"]["zone"] == "A"
    eng_id = body["engineer"]["id"]
    assert body["user"]["engineer_id"] == eng_id

    # the linked user row exists with the right wiring
    session = get_session()
    try:
        u = session.query(User).filter(User.username == uname).first()
        assert u is not None and u.role == "technician" and u.zone == "A" and u.engineer_id == eng_id
    finally:
        session.close()

    # login with the new creds (default password) works
    assert _login(uname).status_code == 200


# ---- (b) non-plant create -> 403 --------------------------------------

def test_b_non_plant_create_403():
    for who in ("fieldA", "ravi"):  # field_manager and a technician
        r = client.post(
            "/engineers",
            headers=_auth(_token(who)),
            json={"name": "Should Fail", "zone": "A", "skills": ["mechanical"]},
        )
        assert r.status_code == 403, f"{who}: {r.text}"


# ---- (c)/(d) deactivate excludes from eligibility; activate restores ---

def test_c_d_deactivate_excludes_then_activate_restores():
    tok = _token("plant")
    created = client.post(
        "/engineers",
        headers=_auth(tok),
        json={"name": "Zane Mechanic", "zone": "A", "skills": ["mechanical"]},
    ).json()
    eng_id = created["engineer"]["id"]

    rec = _mech_record("A")
    # active by default -> a candidate for a matching fault
    assert eng_id in _candidate_ids(rec)

    # (c) deactivate -> excluded from assignment eligibility
    d = client.post(f"/engineers/{eng_id}/deactivate", headers=_auth(tok))
    assert d.status_code == 200 and d.json()["active"] is False
    assert eng_id not in _candidate_ids(rec)

    # idempotent
    assert client.post(f"/engineers/{eng_id}/deactivate", headers=_auth(tok)).status_code == 200

    # (d) activate -> eligible again
    a = client.post(f"/engineers/{eng_id}/activate", headers=_auth(tok))
    assert a.status_code == 200 and a.json()["active"] is True
    assert eng_id in _candidate_ids(rec)


# ---- (e) validation + auth codes --------------------------------------

def test_e_validation_and_auth_codes():
    tok = _token("plant")

    # duplicate username -> 400
    client.post("/engineers", headers=_auth(tok),
                json={"name": "First One", "zone": "B", "skills": [], "username": "dupuser"})
    dup = client.post("/engineers", headers=_auth(tok),
                      json={"name": "Second One", "zone": "B", "skills": [], "username": "dupuser"})
    assert dup.status_code == 400, dup.text

    # bad zone -> 400
    bad = client.post("/engineers", headers=_auth(tok),
                      json={"name": "Bad Zone", "zone": "Z", "skills": []})
    assert bad.status_code == 400, bad.text

    # no token -> 401. Clear the cookie jar too: _login() above set the browser
    # session cookie on the shared TestClient, so a truly-unauthenticated request
    # must omit BOTH the Bearer header and the cookie.
    client.cookies.clear()
    assert client.post("/engineers", json={"name": "No Auth", "zone": "A", "skills": []}).status_code == 401

    # unknown id deactivate -> 404
    assert client.post("/engineers/999999/deactivate", headers=_auth(tok)).status_code == 404


# ---- GET /engineers reuses scope_engineer_query ------------------------

def test_get_engineers_scoped():
    # plant sees all (>= 16 seeded) and rows carry the `active` flag
    plant_rows = client.get("/engineers", headers=_auth(_token("plant"))).json()
    assert isinstance(plant_rows, list) and len(plant_rows) >= 16
    assert all("active" in r for r in plant_rows)

    # field_manager C sees only zone-C engineers
    fc = client.get("/engineers", headers=_auth(_token("fieldC"))).json()
    assert fc and all(r["zone"] == "C" for r in fc)

    # no token -> 401 (clear the cookie jar so the request carries no session
    # cookie either — _token()/_login() above set one on the shared TestClient).
    client.cookies.clear()
    assert client.get("/engineers").status_code == 401


def test_deactivate_rotates_tasks():
    # Setup test DB state w/ clean seeding.
    seed()
    tok = _token("plant")
    session = get_session()
    try:
        from db import Assignment
        # Create a mechanical task assigned to Ravi Kumar (id=1)
        t1 = Assignment(
            alarm_id=9999,
            machine="Test Pump A",
            zone="A",
            fault_category="mechanical",
            engineer_id=1,
            engineer_name="Ravi Kumar",
            status="assigned"
        )
        session.add(t1)
        session.commit()
    finally:
        session.close()

    # Deactivate Ravi (id=1)
    res = client.post("/engineers/1/deactivate", headers=_auth(tok))
    assert res.status_code == 200, res.text

    session = get_session()
    try:
        t = session.query(Assignment).filter(Assignment.alarm_id == 9999).first()
        assert t is not None
        # Should rotate to another mechanical engineer, not Ravi, and not Unassigned
        assert t.engineer_id is not None
        assert t.engineer_id != 1
        assert t.engineer_name != "Ravi Kumar"
        assert t.engineer_name != "Unassigned"
        # Verify the new engineer has the mechanical skill
        new_eng = session.get(Engineer, t.engineer_id)
        assert "mechanical" in (new_eng.skills or [])
    finally:
        session.close()


def test_deactivate_fallback_to_unassigned():
    seed()
    tok = _token("plant")
    session = get_session()
    try:
        from db import Assignment
        # Deactivate all mechanical engineers except Ravi
        for eid in (5, 9, 10, 14):
            eng = session.get(Engineer, eid)
            eng.active = False
        # Lena Vogel (id=3, generalist) has mechanical skill too, deactivate her
        eng3 = session.get(Engineer, 3)
        eng3.active = False

        # Create a mechanical task for Ravi Kumar
        t1 = Assignment(
            alarm_id=9998,
            machine="Test Pump A",
            zone="A",
            fault_category="mechanical",
            engineer_id=1,
            engineer_name="Ravi Kumar",
            status="assigned"
        )
        session.add(t1)
        session.commit()
    finally:
        session.close()

    # Deactivate Ravi (id=1)
    res = client.post("/engineers/1/deactivate", headers=_auth(tok))
    assert res.status_code == 200, res.text

    session = get_session()
    try:
        t = session.query(Assignment).filter(Assignment.alarm_id == 9998).first()
        assert t is not None
        # Should fall back to Unassigned
        assert t.engineer_id is None
        assert t.engineer_name == "Unassigned"
    finally:
        session.close()

