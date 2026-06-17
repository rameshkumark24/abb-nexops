"""
Stage 3b — server-side role+zone SCOPING tests.

Proves the SAME endpoint returns different data per logged-in user, and that
write actions are 403'd when out of scope (distinct from 401 no-token).

ISOLATION: points DATABASE_URL at a throwaway SQLite file BEFORE any project
import, so the real demo DB (nexops.db) is never touched. The FastAPI TestClient
is built WITHOUT its `with` context, so startup/shutdown (MQTT connect) never
fire — only the HTTP surface is exercised.

Run:  pytest test_scoping.py      (do NOT run as part of this task)
"""

import os

# MUST precede project imports: db.py reads DATABASE_URL at import time.
os.environ["DATABASE_URL"] = "sqlite:///./test_scoping_tmp.db"

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


def _mk_task(session, engineer=None, zone=None):
    """Create one open assignment; return its id.

    Stage 3b+ machine-zone semantics: Assignment.zone is the MACHINE's zone.
      - zone defaults to the engineer's zone when not given (keeps the original
        a-g cases as same-zone machine tasks).
      - pass an explicit `zone` different from the engineer's zone to model a
        CROSS-ZONE fallback dispatch.
      - pass engineer=None to model an UNASSIGNED task (engineer_id NULL).
    """
    eng_id = engineer.id if engineer is not None else None
    eng_name = engineer.name if engineer is not None else None
    task_zone = zone if zone is not None else (engineer.zone if engineer is not None else None)
    a = Assignment(
        machine=f"M-{eng_id if eng_id is not None else 'X'}",
        zone=task_zone,
        fault_category="mechanical",
        engineer_id=eng_id,
        engineer_name=eng_name,
        status="assigned",
    )
    session.add(a)
    session.commit()
    session.refresh(a)
    return a.id


def _tech_username_for(session, engineer_id):
    u = (
        session.query(User)
        .filter(User.role == "technician", User.engineer_id == engineer_id)
        .first()
    )
    assert u is not None
    return u.username


# ---- (a) plant sees ALL zones ----------------------------------------

def test_a_plant_sees_all_zones():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        # one task in each of A/B/C/D
        for zone in ("A", "B", "C", "D"):
            _mk_task(session, by_zone[zone][0])
    finally:
        session.close()

    tok = _login("plant")
    rows = client.get("/tasks", headers=_auth(tok)).json()
    machines = {r["machine"] for r in rows}
    # at least one task from each zone is visible to plant
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        for zone in ("A", "B", "C", "D"):
            eid = by_zone[zone][0].id
            assert f"M-{eid}" in machines, f"plant should see zone {zone} task"
    finally:
        session.close()


# ---- (b) field_manager sees ONLY his zone ----------------------------

def test_b_fieldC_sees_only_zone_C():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        zoneC_eids = {e.id for e in by_zone["C"]}
        other_eids = {e.id for z in ("A", "B", "D") for e in by_zone[z]}
    finally:
        session.close()

    tok = _login("fieldC")
    rows = client.get("/tasks", headers=_auth(tok)).json()
    eng_ids = {r["engineer_id"] for r in rows}

    assert eng_ids, "fieldC should see at least one zone-C task"
    assert eng_ids <= zoneC_eids, f"fieldC leaked non-zone-C engineers: {eng_ids - zoneC_eids}"
    assert not (eng_ids & other_eids), "fieldC must see ZERO A/B/D tasks"


# ---- (c) technician sees ONLY his own tasks --------------------------

def test_c_technician_sees_only_own_tasks():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        me = by_zone["A"][0]           # the technician's engineer
        other = by_zone["A"][1]        # a different engineer (same zone)
        my_t1 = _mk_task(session, me)
        my_t2 = _mk_task(session, me)
        _mk_task(session, other)       # not mine
        my_username = _tech_username_for(session, me.id)
        my_engineer_id = me.id
    finally:
        session.close()

    tok = _login(my_username)
    rows = client.get("/tasks", headers=_auth(tok)).json()
    eng_ids = {r["engineer_id"] for r in rows}
    ids = {r["id"] for r in rows}

    assert eng_ids == {my_engineer_id}, f"technician saw other engineers: {eng_ids}"
    assert my_t1 in ids and my_t2 in ids


# ---- (d) technician resolving ANOTHER tech's task -> 403 -------------

def test_d_technician_resolve_others_task_403():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        me = by_zone["B"][0]
        other = by_zone["B"][1]
        others_task = _mk_task(session, other)
        my_username = _tech_username_for(session, me.id)
    finally:
        session.close()

    tok = _login(my_username)
    r = client.post(f"/tasks/{others_task}/resolve", headers=_auth(tok))
    assert r.status_code == 403, r.text


# ---- (e) field_manager resolving OUTSIDE his zone -> 403 -------------

def test_e_field_manager_resolve_out_of_zone_403():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        zoneA_task = _mk_task(session, by_zone["A"][0])  # a zone-A task
    finally:
        session.close()

    tok = _login("fieldC")  # manager of zone C
    r = client.post(f"/tasks/{zoneA_task}/resolve", headers=_auth(tok))
    assert r.status_code == 403, r.text


# ---- (f) no token on a scoped endpoint -> 401 ------------------------

def test_f_no_token_401():
    assert client.get("/tasks").status_code == 401
    assert client.post("/tasks/1/resolve").status_code == 401
    assert client.post("/tasks/1/start").status_code == 401


# ---- (g) plant resolves ANY task -> 200 ------------------------------

def test_g_plant_resolves_any_task_200():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        task = _mk_task(session, by_zone["D"][0])  # a zone-D task
    finally:
        session.close()

    tok = _login("plant")
    r = client.post(f"/tasks/{task}/resolve", headers=_auth(tok))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "resolved"


# ---- in-scope writes still succeed (positive control) ----------------

def test_technician_resolves_own_task_200():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        me = by_zone["C"][0]
        my_task = _mk_task(session, me)
        my_username = _tech_username_for(session, me.id)
    finally:
        session.close()

    tok = _login(my_username)
    r = client.post(f"/tasks/{my_task}/resolve", headers=_auth(tok))
    assert r.status_code == 200, r.text


def test_field_manager_resolves_in_zone_200():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        zoneC_task = _mk_task(session, by_zone["C"][1])
    finally:
        session.close()

    tok = _login("fieldC")
    r = client.post(f"/tasks/{zoneC_task}/resolve", headers=_auth(tok))
    assert r.status_code == 200, r.text


# ---- (h) CROSS-ZONE task visible to the MACHINE's zone manager only ----

def test_h_cross_zone_task_visible_to_machine_zone_manager():
    # machine zone C, but the responding engineer is in zone D.
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        engD = by_zone["D"][0]
        task_id = _mk_task(session, engineer=engD, zone="C")
    finally:
        session.close()

    # field_manager C SEES it (machine zone C), even though the responder is D.
    rowsC = client.get("/tasks", headers=_auth(_login("fieldC"))).json()
    assert task_id in {r["id"] for r in rowsC}

    # field_manager D does NOT (the responder is his, but the MACHINE is not).
    rowsD = client.get("/tasks", headers=_auth(_login("fieldD"))).json()
    assert task_id not in {r["id"] for r in rowsD}


# ---- (i) UNASSIGNED task surfaces to the zone manager + plant, not tech ----

def test_i_unassigned_task_visible_to_zone_manager_not_technician():
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        task_id = _mk_task(session, engineer=None, zone="C")  # engineer_id NULL, zone C
        tech_username = _tech_username_for(session, by_zone["C"][0].id)
    finally:
        session.close()

    # field_manager C SEES it (zone is on the row, not derived from an engineer).
    rowsC = client.get("/tasks", headers=_auth(_login("fieldC"))).json()
    assert task_id in {r["id"] for r in rowsC}

    # technician does NOT (it's nobody's task -> not his engineer_id).
    rowsT = client.get("/tasks", headers=_auth(_login(tech_username))).json()
    assert task_id not in {r["id"] for r in rowsT}

    # plant SEES it.
    rowsP = client.get("/tasks", headers=_auth(_login("plant"))).json()
    assert task_id in {r["id"] for r in rowsP}


# ---- (j) field_manager resolves a cross-zone MACHINE task -> 200 ------

def test_j_field_manager_resolves_cross_zone_machine_task_200():
    # machine zone C, responder zone D -> field_manager C may act (machine zone).
    session = get_session()
    try:
        by_zone = _engineers_by_zone(session)
        engD = by_zone["D"][1]
        task_id = _mk_task(session, engineer=engD, zone="C")
    finally:
        session.close()

    r = client.post(f"/tasks/{task_id}/resolve", headers=_auth(_login("fieldC")))
    assert r.status_code == 200, r.text
