"""
Per-engineer stats endpoint tests — GET /engineers/{id}/stats (Stage: stats).

Proves the endpoint returns HONEST counts + real MTTR (from stored
Assignment.resolution_minutes) and enforces the SAME role/zone scoping as the
rest of the app (reusing scoping.scope_engineer_query): technician=self only,
field_manager=in-zone, plant=any.

ISOLATION: points DATABASE_URL at a throwaway SQLite file BEFORE any project
import (real demo DB untouched). TestClient is built WITHOUT its `with` context,
so startup/shutdown (MQTT connect) never fire — HTTP surface only.

Run:  pytest test_stats.py      (do NOT run as part of this task)
"""

import os

# MUST precede project imports: db.py reads DATABASE_URL at import time.
os.environ["DATABASE_URL"] = "sqlite:///./test_stats_tmp.db"

from fastapi.testclient import TestClient

import main
from db import Assignment, Engineer, User, get_session
from seed import seed

client = TestClient(main.app)
PASSWORD = "nexops123"  # the seeded DEV_PASSWORD


def setup_module(module):
    """Wipe+reseed (16 engineers + 21 users) into the throwaway DB."""
    seed()


# ---- helpers ----------------------------------------------------------

def _login(username):
    r = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _engineers_by_zone(session):
    by = {}
    for e in session.query(Engineer).all():
        by.setdefault(e.zone, []).append(e)
    return by


def _tech_username_for(session, engineer_id):
    u = (
        session.query(User)
        .filter(User.role == "technician", User.engineer_id == engineer_id)
        .first()
    )
    assert u is not None
    return u.username


def _mk_assignment(session, engineer, status, resolution_minutes=None):
    """Create one assignment for an engineer in a given lifecycle status."""
    a = Assignment(
        machine=f"M-{engineer.id}",
        zone=engineer.zone,
        fault_category="mechanical",
        engineer_id=engineer.id,
        engineer_name=engineer.name,
        status=status,
        resolution_minutes=resolution_minutes,
    )
    session.add(a)
    session.commit()
    session.refresh(a)
    return a.id


# ---- (a) technician fetches OWN stats -> 200 + correct resolved_count ----

def test_a_technician_own_stats():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        me = by_zone["A"][0]
        # 2 resolved (with real resolution_minutes), 1 in_progress, 1 assigned.
        _mk_assignment(session, me, "resolved", 30.0)
        _mk_assignment(session, me, "resolved", 50.0)
        _mk_assignment(session, me, "in_progress")
        _mk_assignment(session, me, "assigned")
        eng_id = me.id
        uname = _tech_username_for(session, eng_id)
    finally:
        session.close()

    r = client.get(f"/engineers/{eng_id}/stats", headers=_auth(_login(uname)))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engineer_id"] == eng_id
    assert body["resolved_count"] == 2
    assert body["active_count"] == 2
    # real MTTR = mean(30, 50) = 40.0 (from stored resolution_minutes, not faked)
    assert body["avg_resolution_minutes"] == 40.0


# ---- (b) technician fetches ANOTHER engineer's stats -> 403 -------------

def test_b_technician_other_engineer_403():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        me = by_zone["B"][0]
        other = by_zone["B"][1]
        uname = _tech_username_for(session, me.id)
        other_id = other.id
    finally:
        session.close()

    r = client.get(f"/engineers/{other_id}/stats", headers=_auth(_login(uname)))
    assert r.status_code == 403, r.text


# ---- (c) field_manager: in-zone -> 200, out-of-zone -> 403 -------------

def test_c_field_manager_in_and_out_of_zone():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        in_zone_id = by_zone["C"][0].id   # fieldC manages zone C
        out_zone_id = by_zone["A"][0].id
    finally:
        session.close()

    tok = _login("fieldC")
    assert client.get(f"/engineers/{in_zone_id}/stats", headers=_auth(tok)).status_code == 200
    assert client.get(f"/engineers/{out_zone_id}/stats", headers=_auth(tok)).status_code == 403


# ---- (d) plant fetches ANY -> 200 --------------------------------------

def test_d_plant_any_engineer():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        ids = [by_zone[z][0].id for z in ("A", "B", "C", "D")]
    finally:
        session.close()

    tok = _login("plant")
    for eid in ids:
        assert client.get(f"/engineers/{eid}/stats", headers=_auth(tok)).status_code == 200


# ---- (e) no token -> 401; unknown id -> 404 ----------------------------

def test_e_no_token_and_unknown_id():
    # no token -> 401 (dependency rejects before any lookup). Clear the cookie jar
    # so a prior _login() session cookie doesn't authenticate this request.
    client.cookies.clear()
    assert client.get("/engineers/1/stats").status_code == 401

    # unknown engineer id -> 404 (plant token so scope can't mask it)
    tok = _login("plant")
    assert client.get("/engineers/999999/stats", headers=_auth(tok)).status_code == 404


# ---- engineer with no resolved tasks -> avg is null, not faked ---------

def test_avg_null_when_no_resolved():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        eng = by_zone["D"][0]
        _mk_assignment(session, eng, "assigned")  # open only, none resolved
        eid = eng.id
    finally:
        session.close()

    body = client.get(f"/engineers/{eid}/stats", headers=_auth(_login("plant"))).json()
    assert body["resolved_count"] == 0
    assert body["avg_resolution_minutes"] is None  # honest null, never fabricated
