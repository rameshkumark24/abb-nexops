"""
Auth foundation (Stage 3a): password hashing, JWT issue/verify, and a FastAPI
dependency that resolves a Bearer token to the current user (role + zone).

NO data scoping here — that is Stage 3b. This module ONLY answers: can a user
log in, and does a token resolve to the right user?

Libraries
---------
  - passlib[bcrypt]  -> password hashing (hash_password / verify_password)
  - PyJWT            -> token signing/decoding (HS256)

Secret handling
---------------
The signing secret comes from the NEXOPS_JWT_SECRET env var, with a DEV fallback
constant so the demo runs with zero setup. The fallback is INSECURE and must be
overridden in any real deployment (state in the report).
"""

import os
import secrets
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import bcrypt
import jwt  # PyJWT
from fastapi import Depends, HTTPException, Request, status

from db import User, get_session

# --- secret / algorithm / lifetime --------------------------------------
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 12

# SECRET RESOLUTION — there is deliberately NO hardcoded fallback constant. A
# committed default secret lets anyone who reads the source forge a plant-manager
# token, which would defeat the entire auth system. Resolution order:
#   1. NEXOPS_JWT_SECRET env var — the ONLY thing to set in production.
#   2. Else a per-deployment RANDOM secret, persisted to a gitignored local file
#      so the demo still runs with zero setup, every machine gets a UNIQUE secret,
#      and issued tokens survive a restart.
#   3. Else (filesystem unavailable) an EPHEMERAL per-process random secret —
#      still never a known constant, so it FAILS CLOSED (the only cost is tokens
#      don't survive a restart / aren't shared across workers).
_SECRET_FILE = Path(__file__).resolve().parent / ".jwt_secret"


def _resolve_secret() -> tuple[str, str]:
    """Return (secret, source). NEVER returns a shared/known constant."""
    env = os.environ.get("NEXOPS_JWT_SECRET")
    if env:
        return env, "env"
    try:
        if _SECRET_FILE.exists():
            existing = _SECRET_FILE.read_text(encoding="utf-8").strip()
            if existing:
                return existing, "file"
        generated = secrets.token_hex(32)  # 256-bit
        _SECRET_FILE.write_text(generated, encoding="utf-8")
        try:
            os.chmod(_SECRET_FILE, 0o600)  # best-effort: owner-only (no-op on some FS)
        except OSError:
            pass
        return generated, "generated"
    except Exception:
        return secrets.token_hex(32), "ephemeral"


JWT_SECRET, JWT_SECRET_SOURCE = _resolve_secret()

# ----------------------------------------------------------------------
# Password hashing (bcrypt used DIRECTLY).
#
# We call the `bcrypt` library directly rather than through passlib: passlib
# 1.7.4 is unmaintained and reads bcrypt.__about__, which bcrypt 5.x removed,
# crashing with "module 'bcrypt' has no attribute '__about__'" (and a spurious
# 72-byte error). Direct bcrypt has no such shim.
#
# bcrypt has a HARD 72-byte input limit (bytes beyond 72 are ignored, and some
# builds raise). We TRUNCATE to 72 bytes on BOTH hash and verify so the two are
# consistent and neither path can raise on a long password. DEV_PASSWORD
# 'nexops123' is far under the limit; this is just safety.
# ----------------------------------------------------------------------

# Max bytes bcrypt will consider; longer inputs are truncated for consistency.
_BCRYPT_MAX_BYTES = 72


def hash_password(plain: str) -> str:
    """bcrypt-hash a password, returning a str safe to store in the String
    column (the bcrypt bytes decoded as ASCII)."""
    digest = bcrypt.hashpw(plain.encode("utf-8")[:_BCRYPT_MAX_BYTES], bcrypt.gensalt())
    return digest.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """True iff `plain` matches `hashed`. Never raises — a malformed hash or any
    backend error reads as 'does not match' (fail CLOSED)."""
    try:
        return bcrypt.checkpw(
            plain.encode("utf-8")[:_BCRYPT_MAX_BYTES], hashed.encode("utf-8")
        )
    except Exception:
        return False


# ----------------------------------------------------------------------
# JWT
# ----------------------------------------------------------------------

def create_token(user) -> str:
    """Sign a JWT for a db.User. Payload: user_id, username, role, zone, iat, exp."""
    now = datetime.now(timezone.utc)
    payload = {
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
        "zone": user.zone,
        # tv = the user's token_version at mint time. Auth rejects the token once
        # the user's token_version moves past this (logout / force-logout).
        "tv": int(getattr(user, "token_version", 0) or 0),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_EXPIRE_HOURS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_ws_ticket(user) -> str:
    """Sign a SHORT-LIVED ticket the browser passes as the WS first message. It
    carries role/zone/tv (so WS zone-scoping + revocation still apply) and a
    'scope':'ws' marker, and expires in WS_TICKET_TTL_SECONDS."""
    now = datetime.now(timezone.utc)
    payload = {
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
        "zone": user.zone,
        "tv": int(getattr(user, "token_version", 0) or 0),
        "scope": "ws",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=WS_TICKET_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str):
    """Return the claims dict, or None if the token is invalid/expired/tampered.
    Never raises — PyJWT's exceptions (expired, bad signature, malformed) all
    collapse to None so callers turn it into a clean 401."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None


# ----------------------------------------------------------------------
# Current-user resolution
# ----------------------------------------------------------------------

@dataclass
class CurrentUser:
    id: int
    username: str
    role: str
    zone: str | None
    engineer_id: int | None


# Name of the httpOnly cookie that carries the session JWT for browser clients
# (set by the backend at login; unreadable by JS, so XSS cannot exfiltrate it).
AUTH_COOKIE = "nexops_token"
# Double-submit CSRF: a RANDOM value placed in a JS-READABLE cookie at login and
# echoed back by the SPA in this header on every unsafe request. A cross-site
# attacker can't read the cookie to set the header, so forged requests fail.
CSRF_COOKIE = "nexops_csrf"
CSRF_HEADER = "X-CSRF-Token"

# Short-lived WebSocket ticket: the SPA can't attach the httpOnly cookie to a
# cross-origin WS handshake, so it fetches a single-use, ~minute-long ticket from
# a cookie-authed endpoint and passes THAT as the WS first message. Stateless
# (signed JWT), so it scales without a server-side ticket store.
WS_TICKET_TTL_SECONDS = 60


def _bearer_token(request: Request):
    """Extract the token from an `Authorization: Bearer <token>` header, or None."""
    header = request.headers.get("Authorization") or request.headers.get("authorization")
    if not header:
        return None
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def _request_token(request: Request):
    """The session JWT for this request: the `Authorization: Bearer` header if
    present (non-browser clients, tests), else the httpOnly auth cookie (browser
    clients). Returning the SOURCE too lets CSRF enforcement target only the
    cookie path (a Bearer header is not auto-sent, so it needs no CSRF guard)."""
    tok = _bearer_token(request)
    if tok:
        return tok, "header"
    cookie = request.cookies.get(AUTH_COOKIE)
    if cookie:
        return cookie, "cookie"
    return None, None


def _load_user_from_request(request: Request):
    """Token -> CurrentUser, or None on any failure. Loads the user FRESH from the
    DB so the returned object carries engineer_id (which is not in the token)."""
    token, _ = _request_token(request)
    if not token:
        return None
    claims = decode_token(token)
    if not claims:
        return None
    user_id = claims.get("user_id")
    if user_id is None:
        return None
    session = get_session()
    try:
        user = session.get(User, user_id)
        if user is None:
            return None
        # Reject DEACTIVATED users immediately — don't wait for token expiry.
        if getattr(user, "active", True) is False:
            return None
        # Reject REVOKED tokens: logout / force-logout bumps token_version, so any
        # token minted with an older tv is no longer valid. Missing tv (legacy
        # token) compares against 0 — still valid until the version first moves.
        if int(claims.get("tv", 0) or 0) != int(getattr(user, "token_version", 0) or 0):
            return None
        return CurrentUser(
            id=user.id,
            username=user.username,
            role=user.role,
            zone=user.zone,
            engineer_id=user.engineer_id,
        )
    except Exception:
        return None
    finally:
        session.close()


def get_current_user(request: Request) -> CurrentUser:
    """FastAPI dependency: require a valid Bearer token. 401 on
    missing/invalid/expired — never a 500."""
    user = _load_user_from_request(request)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing or invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_current_user_optional(request: Request):
    """FastAPI dependency: resolve the token if present, else return None (no
    401). For routes that stay public during the 3a->3b transition."""
    return _load_user_from_request(request)


def revoke_user_tokens(session, user_id: int) -> bool:
    """Invalidate ALL of a user's outstanding JWTs by bumping token_version (real
    server-side logout / force-logout). Caller owns the session/commit decision;
    we commit here so the new version is durable before the response returns.
    Returns True if the user existed."""
    user = session.get(User, user_id)
    if user is None:
        return False
    user.token_version = int(getattr(user, "token_version", 0) or 0) + 1
    session.commit()
    return True


# ----------------------------------------------------------------------
# JWT-secret startup advisory
# ----------------------------------------------------------------------

def warn_insecure_secret() -> None:
    """Advise on the JWT secret source at startup. There is no longer a known
    default constant to forge, so this is informational — except the EPHEMERAL
    case, which is flagged because tokens won't survive a restart / multi-worker."""
    if JWT_SECRET_SOURCE == "env":
        return  # production-correct: nothing to warn about.
    if JWT_SECRET_SOURCE == "ephemeral":
        banner = "!" * 64
        print(f"\n{banner}")
        print("  NOTICE: JWT secret is EPHEMERAL (could not persist a local")
        print("  secret file). Issued tokens are invalidated on restart and are")
        print("  NOT shared across workers. Set NEXOPS_JWT_SECRET to fix.")
        print(f"{banner}\n")
    else:
        # "file" or "generated": a unique local secret is in use (safe for dev).
        print(f"[auth] using a local per-deployment JWT secret "
              f"({_SECRET_FILE.name}); set NEXOPS_JWT_SECRET for production.")


# ----------------------------------------------------------------------
# Login rate limiter  (in-memory, per-IP + per-username)
# ----------------------------------------------------------------------

_ATTEMPT_WINDOW_S  = 5 * 60    # sliding window: 5 minutes
_MAX_IP_ATTEMPTS   = 10         # max failures per IP before lockout
_MAX_USER_ATTEMPTS = 5          # max failures per username before lockout
_LOCKOUT_S         = 15 * 60   # lockout duration: 15 minutes

@dataclass
class _Bucket:
    timestamps: list = field(default_factory=list)
    locked_until: float = 0.0

_rate_lock   = threading.Lock()
_ip_buckets: dict[str, _Bucket]   = defaultdict(_Bucket)
_user_buckets: dict[str, _Bucket] = defaultdict(_Bucket)


def check_rate_limit(ip: str, username: str) -> tuple[bool, str]:
    """Return (allowed, reason). Call BEFORE verifying credentials."""
    now = time.monotonic()
    with _rate_lock:
        for bucket, limit in [(_ip_buckets[ip], _MAX_IP_ATTEMPTS),
                               (_user_buckets[username.strip().lower()], _MAX_USER_ATTEMPTS)]:
            if bucket.locked_until > now:
                wait = int((bucket.locked_until - now) / 60) + 1
                return False, f"Too many failed attempts. Try again in {wait} minute(s)."
            bucket.timestamps = [t for t in bucket.timestamps if now - t < _ATTEMPT_WINDOW_S]
    return True, ""


def record_failed_attempt(ip: str, username: str) -> None:
    """Stamp a failure; trigger lockout if the threshold is reached."""
    now = time.monotonic()
    with _rate_lock:
        for bucket, limit in [(_ip_buckets[ip], _MAX_IP_ATTEMPTS),
                               (_user_buckets[username.strip().lower()], _MAX_USER_ATTEMPTS)]:
            bucket.timestamps.append(now)
            bucket.timestamps = [t for t in bucket.timestamps if now - t < _ATTEMPT_WINDOW_S]
            if len(bucket.timestamps) >= limit:
                bucket.locked_until = now + _LOCKOUT_S
                bucket.timestamps = []


def clear_rate_limit(ip: str, username: str) -> None:
    """Reset counters after a successful login."""
    with _rate_lock:
        _ip_buckets[ip] = _Bucket()
        _user_buckets[username.strip().lower()] = _Bucket()


# ----------------------------------------------------------------------
# Role-enforcement dependency factory
# ----------------------------------------------------------------------

def require_role(*roles: str) -> Callable:
    """FastAPI dependency factory that enforces role membership.

    Usage:
        @app.post("/admin/thing")
        def endpoint(current: CurrentUser = Depends(require_role("plant_manager"))):
            ...
    """
    def _check(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current.role}' is not authorised for this action.",
            )
        return current
    return _check
