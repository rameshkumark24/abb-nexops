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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt  # PyJWT
from fastapi import HTTPException, Request, status

from db import User, get_session

# --- secret / algorithm / lifetime --------------------------------------
# DEV FALLBACK is insecure on purpose: override NEXOPS_JWT_SECRET in production.
JWT_SECRET = os.environ.get("NEXOPS_JWT_SECRET", "dev-insecure-nexops-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 12

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
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_EXPIRE_HOURS)).timestamp()),
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


def _bearer_token(request: Request):
    """Extract the token from an `Authorization: Bearer <token>` header, or None."""
    header = request.headers.get("Authorization") or request.headers.get("authorization")
    if not header:
        return None
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def _load_user_from_request(request: Request):
    """Token -> CurrentUser, or None on any failure. Loads the user FRESH from the
    DB so the returned object carries engineer_id (which is not in the token)."""
    token = _bearer_token(request)
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
