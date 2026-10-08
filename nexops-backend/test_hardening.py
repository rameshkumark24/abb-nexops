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


# ---- embedded simulator / fast KB seed -------------------------------------------

def test_embedded_simulator_record_flows_through_pipeline():
    """A simulator record fed to process_record() comes out enriched and cached,
    exactly as an MQTT message would."""
    sim = main._load_simulator()
    record = main.process_record(sim.generate_next_record(1))
    for key in ("anomaly_status", "nexops_risk", "is_early", "site_alert",
                "assigned_engineer", "zone"):
        assert key in record
    with main._states_lock:
        assert main.latest_machine_states[record["Machine"]] is record


def test_knowledge_base_json_matches_pdf():
    """The pre-parsed JSON used for fast startup seeding must stay in sync with
    the PDF it was generated from."""
    import seed_qa
    assert seed_qa.load_qa_pairs() == seed_qa.parse_qa_from_pdf(seed_qa.DEFAULT_PDF)


def test_health_endpoints_accept_head():
    assert client.head("/").status_code == 200
    assert client.head("/healthz").status_code == 200


# ---- ingest + live-feed URL -----------------------------------------------------

def test_ingest_disabled_without_token(monkeypatch):
    monkeypatch.setattr(main.config, "INGEST_TOKEN", "")
    r = client.post("/ingest/telemetry", json={"Machine": "Pump A1"})
    assert r.status_code == 404


def test_ingest_requires_token_and_processes_records(monkeypatch):
    monkeypatch.setattr(main.config, "INGEST_TOKEN", "s3cret-token")
    sim = main._load_simulator()
    batch = [sim.generate_next_record(i) for i in range(1, 4)] + ["junk"]

    assert client.post("/ingest/telemetry", json=batch).status_code == 401
    assert client.post("/ingest/telemetry", json=batch,
                       headers={"Authorization": "Bearer wrong"}).status_code == 401

    r = client.post("/ingest/telemetry", json=batch,
                    headers={"Authorization": "Bearer s3cret-token"})
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 3, "rejected": 1}
    with main._states_lock:
        assert batch[0]["Machine"] in main.latest_machine_states


def test_ws_ticket_includes_public_ws_url(monkeypatch):
    monkeypatch.setattr(main.config, "PUBLIC_WS_URL", "wss://api.example.com/ws")
    tok = _token("plant")
    body = client.get("/auth/ws-ticket", headers=_auth(tok)).json()
    assert body["ws_url"] == "wss://api.example.com/ws" and body["ticket"]


def test_public_ws_url_derived_from_render(monkeypatch):
    monkeypatch.delenv("PUBLIC_WS_URL", raising=False)
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://svc.onrender.com/")
    assert main.config._public_ws_url() == "wss://svc.onrender.com/ws"


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


def _answer(text, finish_reason="stop"):
    return _Resp(200, {"choices": [{"message": {"content": text},
                                    "finish_reason": finish_reason}]})


def _fake_groq(monkeypatch, on_post, models=()):
    """Route aria's Groq HTTP calls to on_post(body) -> _Resp. Returns the calls
    made: ("POST", request body) and ("GET", url)."""
    import aria

    calls = []

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, **kw):
            calls.append(("GET", url))
            return _Resp(200, {"data": [{"id": m, "active": True} for m in models]})

        async def post(self, url, json=None, **kw):
            calls.append(("POST", json))
            return on_post(json)

    monkeypatch.setattr(aria.httpx, "AsyncClient", lambda *a, **k: FakeClient())
    monkeypatch.setattr(aria, "GROQ_API_KEY", "k")
    monkeypatch.setattr(aria, "_groq_model_override", None)
    monkeypatch.setattr(aria, "_groq_plain_models", set())
    return calls


def test_groq_retired_model_is_replaced(monkeypatch):
    """Groq answers 404 for a retired model: ARIA must discover a current model,
    retry once, and keep using it."""
    import asyncio
    import aria

    def on_post(body):
        if body["model"] == "retired-model":
            return _Resp(404, {"error": {"code": "model_not_found"}})
        return _answer("grounded answer")

    calls = _fake_groq(monkeypatch, on_post,
                       models=("whisper-large-v3", "openai/gpt-oss-120b"))
    monkeypatch.setattr(aria, "GROQ_MODEL", "retired-model")

    assert asyncio.run(aria._call_groq("q")) == "grounded answer"
    assert [(verb, x if verb == "GET" else x["model"]) for verb, x in calls] == [
        ("POST", "retired-model"),
        ("GET", "https://api.groq.com/openai/v1/models"),
        ("POST", "openai/gpt-oss-120b")]
    # Remembered: the next call goes straight to the working model.
    calls.clear()
    asyncio.run(aria._call_groq("q2"))
    assert [body["model"] for _, body in calls] == ["openai/gpt-oss-120b"]


def test_groq_reasoning_model_keeps_room_for_the_answer(monkeypatch):
    """Groq's current chat models reason before answering, and that reasoning
    shares the token budget: ARIA asks for short reasoning, leaves room for the
    answer, and strips any inline <think> block from the reply."""
    import asyncio
    import aria

    calls = _fake_groq(monkeypatch,
                       lambda body: _answer("<think>scratch work</think>\nPump B2 is fine."))
    monkeypatch.setattr(aria, "GROQ_MODEL", "openai/gpt-oss-120b")

    assert asyncio.run(aria._call_groq("q")) == "Pump B2 is fine."
    body = calls[0][1]
    assert body["reasoning_effort"] == "low"
    assert body["max_completion_tokens"] >= 1024
    assert aria._groq_reasoning_params("qwen/qwen3.8-27b") == {"reasoning_effort": "none"}
    assert aria._groq_reasoning_params("some-instruct-model") == {}


def test_groq_refused_reasoning_settings_are_dropped(monkeypatch):
    import asyncio
    import aria

    def on_post(body):
        if "reasoning_effort" in body:
            return _Resp(400, {"error": {
                "param": "reasoning_effort",
                "message": "`reasoning_effort` is not supported with this model"}})
        return _answer("plain answer")

    calls = _fake_groq(monkeypatch, on_post)
    monkeypatch.setattr(aria, "GROQ_MODEL", "openai/gpt-oss-120b")

    assert asyncio.run(aria._call_groq("q")) == "plain answer"
    assert ["reasoning_effort" in body for _, body in calls] == [True, False]
    # Remembered: later questions skip the refused settings.
    calls.clear()
    asyncio.run(aria._call_groq("q2"))
    assert ["reasoning_effort" in body for _, body in calls] == [False]


def test_groq_reply_without_answer_falls_back(monkeypatch):
    """A reply whose whole budget went to reasoning has no answer text; ARIA
    must use its offline answer rather than show an empty one."""
    import asyncio
    import aria

    _fake_groq(monkeypatch, lambda body: _answer("<think>still thinking", "length"))
    monkeypatch.setattr(aria, "GROQ_MODEL", "openai/gpt-oss-120b")
    assert asyncio.run(aria._call_groq("q")) is None
