"""
Regression tests for the deployment-hardening pass.

Each test pins a flaw that was reproduced against the running stack:
  - ARIA returned HTTP 500 when the asked-about machine had an open UNASSIGNED
    task (engineer_name NULL failed response validation).
  - A logged-out (revoked) token still opened the live WebSocket feed.
  - A short-lived WS ticket was also accepted as a REST session credential.
  - seed() (auto-run on an empty DB) wiped the ARIA knowledge base table.
  - Manual assignment left the live-feed dedupe cache stale ("Unassigned"), and
    allowed assigning off-shift engineers / resolved tasks.

TestClient is built WITHOUT its `with` context, so no MQTT connection is made.
"""

import os

# MUST precede project imports: db.py reads DATABASE_URL at import time.
os.environ["DATABASE_URL"] = "sqlite:///./test_hardening_tmp.db"

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import main
from auth_jwt import create_ws_ticket
from db import Assignment, Engineer, IndustrialQA, User, get_session, init_db
from seed import seed, DEV_PASSWORD

client = TestClient(main.app)


def setup_module(module):
    init_db()
    seed()


def _token(username):
    r = client.post("/auth/login", json={"username": username, "password": DEV_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _add_task(machine, zone, category, engineer=None, status="assigned"):
    s = get_session()
    try:
        a = Assignment(machine=machine, zone=zone, fault_category=category,
                       engineer_id=engineer.id if engineer else None,
                       engineer_name=engineer.name if engineer else None,
                       status=status)
        s.add(a)
        s.commit()
        return a.id
    finally:
        s.close()


# ---- ARIA ---------------------------------------------------------------

def test_aria_answers_when_focus_machine_has_unassigned_task():
    _add_task("Compressor A1", "A", "hydraulic")  # open + UNASSIGNED
    with main._states_lock:
        main.latest_machine_states["Compressor A1"] = {
            "Machine": "Compressor A1", "zone": "A", "nexops_risk": "HIGH",
            "Status": "Warning", "features": {"vibration": 5.0},
        }
    try:
        r = client.post("/aria/ask", json={"query": "What is happening on Compressor A1?"},
                        headers=_auth(_token("plant")))
        assert r.status_code == 200, r.text
        assert r.json()["evidence"]["assigned_engineer"] == "Unassigned"
    finally:
        with main._states_lock:
            main.latest_machine_states.pop("Compressor A1", None)


# ---- WebSocket auth -------------------------------------------------------

def test_ws_rejects_revoked_token():
    tok = _token("plant")
    assert client.post("/auth/logout", headers=_auth(tok)).status_code == 200
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": tok})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
    assert exc.value.code == 4003


def test_ws_rejects_deactivated_user_ticket():
    s = get_session()
    try:
        eng = s.query(Engineer).filter(Engineer.name == "Sam Okafor").one()
        user = s.query(User).filter(User.engineer_id == eng.id).one()
        ticket = create_ws_ticket(user)
        eng_id = eng.id
    finally:
        s.close()
    plant = _token("plant")
    assert client.post(f"/engineers/{eng_id}/deactivate", headers=_auth(plant)).status_code == 200
    try:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "auth", "token": ticket})
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_text()
        assert exc.value.code == 4003
    finally:
        client.post(f"/engineers/{eng_id}/activate", headers=_auth(plant))


def test_ws_ticket_accepted_and_scoped_from_db():
    tok = _token("fieldB")
    ticket = client.get("/auth/ws-ticket", headers=_auth(tok)).json()["ticket"]
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": ticket})
        # Registered with the DB user's role/zone.
        for _ in range(50):
            if main.manager.active:
                break
            import time
            time.sleep(0.02)
        assert any(role == "field_manager" and zone == "B"
                   for _ws, role, zone in main.manager.active)


def test_ws_ticket_is_not_a_rest_credential():
    tok = _token("plant")
    ticket = client.get("/auth/ws-ticket", headers=_auth(tok)).json()["ticket"]
    assert client.get("/auth/me", headers=_auth(ticket)).status_code == 401


# ---- seeding --------------------------------------------------------------

def test_roster_reseed_preserves_knowledge_base():
    s = get_session()
    try:
        s.add(IndustrialQA(section_number=1, section_name="Bearings",
                           question="Why do bearings overheat?", answer="Lubrication."))
        s.commit()
    finally:
        s.close()
    seed()
    s = get_session()
    try:
        assert s.query(IndustrialQA).count() >= 1
    finally:
        s.close()


# ---- manual assignment ------------------------------------------------------

def test_manual_assign_refreshes_live_cache_and_validates_target():
    plant = _token("plant")
    s = get_session()
    try:
        diego = s.query(Engineer).filter(Engineer.name == "Diego Santos").one()  # off shift
        lena = s.query(Engineer).filter(Engineer.name == "Lena Vogel").one()
        diego_id, lena_id = diego.id, lena.id
    finally:
        s.close()

    task_id = _add_task("Pump A1", "A", "general")
    key = ("Pump A1", "general")
    with main._assign_lock:
        main.active_assignments[key] = {"engineer_id": None, "engineer_name": "Unassigned"}

    r = client.post(f"/tasks/{task_id}/assign", json={"engineer_id": diego_id}, headers=_auth(plant))
    assert r.status_code == 400 and "off-shift" in r.json()["error"]

    r = client.post(f"/tasks/{task_id}/assign", json={"engineer_id": lena_id}, headers=_auth(plant))
    assert r.status_code == 200, r.text
    with main._assign_lock:
        assert key not in main.active_assignments  # next tick re-reads the DB

    resolved_id = _add_task("Motor A1", "A", "general", status="resolved")
    r = client.post(f"/tasks/{resolved_id}/assign", json={"engineer_id": lena_id}, headers=_auth(plant))
    assert r.status_code == 409


# ---- passwords ----------------------------------------------------------------

def test_blank_seed_password_env_falls_back_to_default(monkeypatch):
    """`NEXOPS_SEED_PASSWORD=` (blank, as in .env.example) must not become the
    password for every seeded account."""
    import importlib
    import seed as seed_module
    monkeypatch.setenv("NEXOPS_SEED_PASSWORD", "")
    try:
        reloaded = importlib.reload(seed_module)
        assert reloaded.DEV_PASSWORD == "nexops123"
        assert reloaded._SEED_PASSWORD_IS_DEFAULT is True
    finally:
        monkeypatch.delenv("NEXOPS_SEED_PASSWORD", raising=False)
        importlib.reload(seed_module)


def test_empty_password_never_logs_in():
    r = client.post("/auth/login", json={"username": "plant", "password": ""})
    assert r.status_code == 401


def test_create_technician_rejects_short_password():
    r = client.post("/engineers", json={"name": "Short Pw", "zone": "A", "password": "abc"},
                    headers=_auth(_token("plant")))
    assert r.status_code == 400


# ---- health -----------------------------------------------------------------

def test_healthz_reports_database_ok():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["database"] is True
