"""
Stage 3a auth foundation tests — login, token resolution, role+zone identity.

ISOLATION: points DATABASE_URL at a SEPARATE throwaway SQLite file BEFORE any
project import, so the real demo DB (nexops.db) is never touched. The FastAPI
TestClient is built WITHOUT its `with` context, so startup/shutdown events do
NOT fire (no MQTT broker connect) — these tests exercise only the HTTP surface.

Run:  pytest test_auth.py      (do NOT run as part of this task)
"""

import os

# MUST precede project imports: db.py reads DATABASE_URL at import time.
os.environ["DATABASE_URL"] = "sqlite:///./test_auth_tmp.db"

import jwt as pyjwt  # PyJWT — to forge an expired token
from fastapi.testclient import TestClient

import main
from db import Engineer, User, get_session
from seed import seed
from auth_jwt import JWT_SECRET, JWT_ALGORITHM

client = TestClient(main.app)

PASSWORD = "nexops123"  # the seeded DEV_PASSWORD


def setup_module(module):
    """Full wipe+reseed into the throwaway DB: 16 engineers + 21 users."""
    seed()


def _login(username, password=PASSWORD):
    return client.post("/auth/login", json={"username": username, "password": password})


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# (a) seed creates 21 users with correct role/zone/engineer wiring.
def test_a_seed_creates_21_users():
    session = get_session()
    try:
        users = session.query(User).all()
        assert len(users) == 21, f"expected 21 users, got {len(users)}"

        plant = [u for u in users if u.role == "plant_manager"]
        fields = [u for u in users if u.role == "field_manager"]
        techs = [u for u in users if u.role == "technician"]

        assert len(plant) == 1
        assert plant[0].zone is None  # plant manager spans the whole site

        assert len(fields) == 4
        assert {u.zone for u in fields} == {"A", "B", "C", "D"}
        assert all(u.engineer_id is None for u in fields)

        assert len(techs) == 16
        for t in techs:
            assert t.engineer_id is not None, f"{t.username} missing engineer_id"
            eng = session.get(Engineer, t.engineer_id)
            assert eng is not None, f"{t.username} points at a missing engineer"
            assert t.zone == eng.zone, f"{t.username} zone {t.zone} != engineer {eng.zone}"
    finally:
        session.close()


# (b) login: correct password -> 200 + token; wrong password -> 401.
def test_b_login_correct_and_wrong():
    ok = _login("plant")
    assert ok.status_code == 200
    body = ok.json()
    assert body.get("token")
    assert body["user"]["role"] == "plant_manager"
    assert body["user"]["zone"] is None

    wrong = _login("plant", "not-the-password")
    assert wrong.status_code == 401

    unknown = _login("nobody")
    assert unknown.status_code == 401


# (c) /auth/me: valid token -> role+zone; no token / tampered / expired -> 401.
def test_c_me_valid_missing_tampered_expired():
    token = _login("fieldB").json()["token"]

    me = client.get("/auth/me", headers=_auth_headers(token))
    assert me.status_code == 200
    body = me.json()
    assert body["role"] == "field_manager"
    assert body["zone"] == "B"

    # no token. Clear the cookie jar too: _login() above set the browser session
    # cookie on the shared TestClient, so "no credentials" must drop BOTH the
    # Bearer header and the cookie.
    client.cookies.clear()
    assert client.get("/auth/me").status_code == 401

    # tampered signature
    assert client.get("/auth/me", headers=_auth_headers(token + "tamper")).status_code == 401

    # expired (exp in 1970)
    expired = pyjwt.encode(
        {"user_id": 1, "username": "plant", "role": "plant_manager", "zone": None, "exp": 1},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )
    assert client.get("/auth/me", headers=_auth_headers(expired)).status_code == 401


# (d) a technician's token resolves to the SAME zone as its linked engineer.
def test_d_technician_token_zone_matches_engineer():
    session = get_session()
    try:
        tech = session.query(User).filter(User.role == "technician").first()
        assert tech is not None
        username = tech.username
        engineer_id = tech.engineer_id
        engineer_zone = session.get(Engineer, engineer_id).zone
    finally:
        session.close()

    token = _login(username).json()["token"]
    me = client.get("/auth/me", headers=_auth_headers(token)).json()
    assert me["zone"] == engineer_zone
    assert me["engineer_id"] == engineer_id
    assert me["role"] == "technician"


# Logout is now a REAL authenticated operation: it revokes the user's tokens
# (bumps token_version) and clears the auth cookies, so it REQUIRES a valid
# session and (for the cookie path) a matching CSRF header.
def test_logout_requires_auth_then_ok():
    # no credentials -> 401 (logout is no longer an anonymous no-op)
    client.cookies.clear()
    assert client.post("/auth/logout").status_code == 401
    # a real session (cookie) + matching CSRF header -> 200
    client.cookies.clear()
    _login("plant")  # sets nexops_token (httpOnly) + nexops_csrf on the jar
    csrf = client.cookies.get("nexops_csrf")
    assert client.post("/auth/logout", headers={"X-CSRF-Token": csrf}).status_code == 200


# Public routes stay reachable WITHOUT a token: health + login (the entry point).
def test_public_routes_token_free():
    assert client.get("/").status_code == 200                  # health, unchanged
    # POST /auth/login is reachable without a prior token and works with valid
    # demo creds (it's the entry point that MINTS the token).
    assert _login("plant").status_code == 200


# Stage 3b INTENTIONALLY gated the /tasks data + write routes: without a token
# they now return 401 (this matches the 3b contract-change list exactly —
# GET /tasks, POST /tasks/{id}/start, POST /tasks/{id}/resolve).
def test_scoped_routes_require_token():
    client.cookies.clear()  # drop any session cookie a prior test's login left
    assert client.get("/tasks").status_code == 401                  # was 200 in 3a
    assert client.post("/tasks/1/start").status_code == 401
    assert client.post("/tasks/1/resolve").status_code == 401
