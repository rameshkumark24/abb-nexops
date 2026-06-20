"""
NexOps backend bridge: MQTT telemetry -> WebSocket fan-out.

ONE job: subscribe to the Mosquitto broker, normalize each record's field
names via adapter.normalize(), and broadcast it to every connected browser
over WebSocket. No ML, no databases, no ARIA here - those are marked TODO
insertion points only.

THREAD -> ASYNCIO HAND-OFF (the tricky bit)
-------------------------------------------
paho-mqtt's network loop runs in its OWN background thread (loop_start), so
its on_message callback fires on a non-asyncio thread. WebSocket sends are
async and belong to the FastAPI/uvicorn event loop. You must NOT touch async
objects from the MQTT thread directly.

The bridge: at startup we capture the running event loop. The MQTT callback
(sync thread) schedules the async broadcast onto that loop with
`asyncio.run_coroutine_threadsafe(coro, loop)`. This is thread-safe and is the
canonical way to push from a worker thread into asyncio - no shared mutable
state is touched across threads except via this scheduling call.
"""

import asyncio
from collections import deque
import json
import os
import re
import sys
import threading
import time

# Make local modules (config.py, adapter.py) resolve no matter how the app is
# launched - `uvicorn main:app`, `python -m uvicorn main:app`, or from any CWD.
# We put THIS file's own directory on sys.path before the local imports below.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import paho.mqtt.client as mqtt
from fastapi import Depends, FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func

import config
from adapter import normalize
from anomaly import AnomalyEngine
from risk import compute_nexops_risk, fallback_risk
from assignment import (
    assign_engineer,
    record_assignment,
    fault_category_for,
    is_safety_critical,
    find_open_assignment,
    find_recent_resolved_assignment,
)
from lifecycle import start_task, resolve_task, get_active_assignments
from db import Assignment, Engineer, User, get_session, init_db
from seed import seed, DEV_PASSWORD
# Stage 3a auth foundation.
from auth_jwt import (
    verify_password, create_token, get_current_user, CurrentUser, hash_password,
    decode_token, warn_insecure_secret, revoke_user_tokens, create_ws_ticket,
    check_rate_limit, record_failed_attempt, clear_rate_limit,
    require_role,
    AUTH_COOKIE, CSRF_COOKIE, CSRF_HEADER, JWT_EXPIRE_HOURS,
)
import hmac
import secrets as _secrets
# Stage 3b server-side role+zone scoping (the rule lives in scoping.py).
from scoping import can_write_assignment, scope_engineer_query
# ARIA system logic helper
import aria

app = FastAPI(title="NexOps MQTT->WebSocket Bridge")

# Warn loudly at startup if the JWT secret is still the insecure dev default.
warn_insecure_secret()


# Security headers on every HTTP response (not WebSocket frames).
@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.update({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    })
    return response


# ----------------------------------------------------------------------
# Auth cookies + CSRF (browser session model).
#
# Browser clients authenticate via an httpOnly `nexops_token` cookie (set at
# login, unreadable by JS so XSS can't steal it). Because a cookie is sent
# AUTOMATICALLY by the browser, cookie-authed UNSAFE requests need CSRF defense:
# we use the stateless DOUBLE-SUBMIT pattern — a random `nexops_csrf` value is
# placed in a JS-READABLE cookie at login and the SPA echoes it in the
# X-CSRF-Token header; the middleware below requires the two to match. Requests
# that authenticate with an `Authorization: Bearer` header instead (tests /
# non-browser clients) are NOT subject to CSRF (that header is never auto-sent).
# ----------------------------------------------------------------------
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Paths that can't carry CSRF yet (no session established) or don't need it.
_CSRF_EXEMPT_PATHS = {"/auth/login"}


def _set_auth_cookies(response: Response, token: str) -> None:
    """Set the httpOnly session cookie + the readable CSRF cookie at login."""
    max_age = JWT_EXPIRE_HOURS * 3600
    response.set_cookie(AUTH_COOKIE, token, max_age=max_age, path="/",
                        httponly=True, samesite="lax", secure=config.COOKIE_SECURE)
    response.set_cookie(CSRF_COOKIE, _secrets.token_urlsafe(32), max_age=max_age,
                        path="/", httponly=False, samesite="lax",
                        secure=config.COOKIE_SECURE)


def _clear_auth_cookies(response: Response) -> None:
    """Drop both auth cookies at logout."""
    response.delete_cookie(AUTH_COOKIE, path="/", samesite="lax")
    response.delete_cookie(CSRF_COOKIE, path="/", samesite="lax")


@app.middleware("http")
async def _csrf_protect(request: Request, call_next):
    method = request.method.upper()
    cookie_authed = (request.headers.get("authorization") is None
                     and request.cookies.get(AUTH_COOKIE) is not None)
    if (method not in _SAFE_METHODS
            and cookie_authed
            and request.url.path not in _CSRF_EXEMPT_PATHS):
        sent = request.headers.get(CSRF_HEADER) or request.headers.get(CSRF_HEADER.lower())
        expected = request.cookies.get(CSRF_COOKIE)
        if not sent or not expected or not hmac.compare_digest(sent, expected):
            return JSONResponse(status_code=403,
                                content={"error": "CSRF token missing or invalid"})
    return await call_next(request)

# One anomaly engine for the whole process. It maintains per-machine state
# internally (rolling window + Isolation Forest per machine), so a single
# instance shared across all MQTT messages is correct.
engine = AnomalyEngine()

# Dedupe of live engineer assignments, keyed by (machine, fault_category). An
# ongoing alarm fires every tick; we assign ONCE and REUSE that engineer on
# subsequent ticks so we don't re-score or re-increment the engineer's load.
# The entry is cleared when the machine returns to Normal/RTN, so a future
# recurrence is treated as a fresh fault. Mutated only from paho's single
# background callback thread, but guarded with a lock for safety.
active_assignments: dict[tuple[str, str], dict] = {}
resolved_timestamps: dict[tuple[str, str], float] = {}
_assign_lock = threading.Lock()

# RECOVERY GRACE after a task is resolved. The simulator heals a machine on its
# OWN ~2-minute timer, independent of task resolution, so a just-resolved machine
# keeps emitting the same high/critical warning for a while. We suppress new
# assignments for this window so the resolve->re-assign loop can't restart. The
# window is RE-ARMED on every suppressed tick (a sliding window), so it can never
# expire while the machine is still emitting the same fault — it lapses only once
# the warnings actually stop (machine healed) or back_to_normal clears it.
RESOLVE_COOLDOWN_SECONDS = 120

# Latest telemetry record received for each machine, keyed by machine name.
# Tracks the current state of the plant to bootstrap new frontend clients on login.
latest_machine_states: dict[str, dict] = {}
# Thread-safe cache containing history of records per machine for linear extrapolation.
history_machine_states: dict[str, deque] = {}
_states_lock = threading.Lock()


def clear_dedupe_for(machine, fault_category) -> bool:
    """Drop the in-memory dedupe entry for (machine, fault_category).

    Called when a task is RESOLVED so that, if the SAME fault recurs on the SAME
    machine later, it is treated as a brand-new fault and re-assigned (instead of
    being wrongly deduped against the now-finished assignment). We match on the
    exact (machine, fault_category) key - the same key on_message() uses when it
    assigns - so the resolved fault's slot is freed. Returns True if an entry was
    removed."""
    if not machine:
        return False
    with _assign_lock:
        resolved_timestamps[(machine, fault_category)] = time.time()
        return active_assignments.pop((machine, fault_category), None) is not None


# ----------------------------------------------------------------------
# EARLY — SINGLE SOURCE OF TRUTH.
# EARLY used to be re-derived in three drifting places (should_assign here,
# isEarlyWarning in the frontend adapter, and an inline check in test_ws.html).
# We now compute it ONCE, here, stamp it on the broadcast record as `is_early`,
# and have both the React app and test_ws READ that boolean. This helper is a
# faithful port of the frontend's isEarlyWarning (the CORRECT, realistic rule
# with the is_predictive divergence branch), evaluated on the record AFTER the
# risk stage — so `nexops_risk` is already the CAPPED value.
# ----------------------------------------------------------------------

_RISK_INDEX = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}

# Gateway alarm_priority -> 0..3 severity index. Mirrors risk._gateway_level and
# the frontend GATEWAY_SEVERITY_INDEX: Critical3/High2/Medium1/Low0/Normal0, and
# anything missing/unrecognized defaults SAFELY to 0 (LOW).
_GATEWAY_SEVERITY_INDEX = {"critical": 3, "high": 2, "medium": 1, "low": 0, "normal": 0}


def _gateway_severity_index(record: dict) -> int:
    prio = str(record.get("alarm_priority", "") or "").strip().lower()
    return _GATEWAY_SEVERITY_INDEX.get(prio, 0)


def _gateway_calm_for_early(record: dict) -> bool:
    """Calm = the gateway itself sees nothing: Status Normal/absent AND
    alarm_priority Low/Normal/absent. 'normal' priority is treated as calm too,
    fixing the latent edge where the backend mapped Normal->LOW (calm) but the
    old frontend gatewayIsCalm did not. FAIL-SAFE: MISSING fields read as calm."""
    status = str(record.get("Status", "") or "").strip().lower()
    prio = str(record.get("alarm_priority", "") or "").strip().lower()
    return status in ("", "normal") and prio in ("", "low", "normal")


def is_early_record(record: dict) -> bool:
    """Canonical EARLY verdict — ports the frontend isEarlyWarning exactly.

    Evaluated AFTER the risk stage, on the CAPPED nexops_risk already on the
    record (so anomaly-only is at most MEDIUM, predictive may be HIGH/CRITICAL).

    PREREQUISITE: anomaly_score must be a real number (not None). NexOps cannot
    claim "we caught it early" when the anomaly engine hasn't produced a score
    yet (warming up / errored). The is_predictive flag still influences
    nexops_risk (via risk.py), but the EARLY BADGE requires actual ML evidence.

      - anomaly_score is None            -> False (no ML evidence yet)
      - is_nuisance is True              -> False (noise is never EARLY)
      - is_predictive is True            -> RISK_INDEX[nexops_risk] > gateway idx
                                            (predictive divergence; full strength)
      - else (anomaly-only)              -> gateway_calm AND RISK_INDEX >= MEDIUM

    FAIL-SAFE: missing is_predictive -> not predictive; missing nexops_risk ->
    LOW -> not early; missing is_nuisance -> not nuisance.
    """
    # ML EVIDENCE GATE: the anomaly engine must have actually scored this record.
    # During warmup (anomaly_score=None), risk may still be elevated by
    # is_predictive (via risk.py), but that's the GATEWAY's own flag — not
    # NexOps's intelligence. Badge only when we have our OWN analysis.
    if record.get("anomaly_score") is None:
        return False
    if record.get("is_nuisance") is True:
        return False
    risk_idx = _RISK_INDEX.get(str(record.get("nexops_risk", "") or "").upper(), 0)
    if record.get("is_predictive") is True:
        return risk_idx > _gateway_severity_index(record)  # predictive divergence
    return _gateway_calm_for_early(record) and risk_idx >= _RISK_INDEX["MEDIUM"]


def should_assign(record: dict) -> bool:
    """True only for genuine, actionable faults - never for plain Normal/LOW,
    and NEVER for nuisance/filterable noise (is_nuisance) regardless of Status.

    Assign when ANY of:
      - it's a critical/SAFETY event (fire/gas/emergency or Critical) - these
        ALWAYS enter the assignment path so the capacity bypass can guarantee
        they're never left unassigned,
      - gateway Status is "Warning" or "Critical",
      - the record is flagged is_predictive,
      - NexOps risk is HIGH or CRITICAL,
      - it's an "early catch": gateway still calm (Status Normal / priority Low)
        but NexOps already elevated the risk to MEDIUM+ (the isEarly case).
    """
    # NUISANCE GUARD (must be FIRST): filterable noise (transient/chatter) is
    # tagged is_nuisance=True at the source and is NEVER an actionable fault, so
    # it must never be assigned or persisted - even though it carries a gateway
    # Status="Warning". This sits ABOVE every other branch (incl. the Status and
    # is_safety_critical checks) so a nuisance "Warning" can't slip through.
    # Fail-safe: a missing/false flag is treated as NOT nuisance.
    if record.get("is_nuisance"):
        return False

    # Safety/critical events ALWAYS get the assignment path (capacity is bypassed
    # downstream in assign_engineer), so a site emergency is never skipped here.
    if is_safety_critical(record):
        return True

    # EARLY catches must ALWAYS be assigned. Share the SAME helper that stamps
    # the broadcast `is_early` flag so a record badged EARLY can NEVER be left
    # unassigned (badge => assign). is_early_record's True set is a subset of /
    # equal to the branches below for the realistic cases, but it also catches
    # the Status-absent + priority-Normal/absent + risk MEDIUM corner the old
    # branches missed. The broader checks below still cover real Warning/Critical
    # faults that are NOT early (those are assigned but not badged EARLY).
    if is_early_record(record):
        return True

    status = record.get("Status")
    if status in ("Warning", "Critical"):
        return True
    if record.get("is_predictive"):
        return True

    risk = str(record.get("nexops_risk", "") or "").upper()
    if risk in ("HIGH", "CRITICAL"):
        return True

    gateway_calm = (
        status == "Normal"
        or str(record.get("alarm_priority", "") or "").lower() == "low"
    )
    if gateway_calm and risk in ("MEDIUM", "HIGH", "CRITICAL"):
        return True

    return False


def emergency_type_for(record: dict):
    """Derive a coarse emergency_type label for the UI, or None.

    Mapping over Alert + message text (checked in order, first hit wins):
      - "gas leak"  -> "gas_leak"
      - "fire"      -> "fire"
      - "emergency" -> "emergency_stop"   (e.g. EMERGENCY STOP ACTIVATED)
      - otherwise   -> None  (a Critical event with no specific signature)
    """
    text = " ".join(
        str(record.get(k, "") or "") for k in ("Alert", "message")
    ).lower()
    if "gas leak" in text:
        return "gas_leak"
    if "fire" in text:
        return "fire"
    if "emergency" in text:
        return "emergency_stop"
    return None

# CORS: the Next.js app on :3000 makes AUTHED cross-origin calls
# (Authorization: Bearer ...). A wildcard origin "*" is INVALID together with
# allow_credentials=True — browsers reject it — so we name the dev origins
# EXPLICITLY and explicitly allow the Authorization + Content-Type request
# headers. Without the Authorization header allowed, every authed fetch from
# React fails with an opaque CORS error. (Stage 3c)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,  # env-driven; set CORS_ORIGINS in production
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# ----------------------------------------------------------------------
# Connection manager: tracks live WebSocket clients and fans out records.
# ----------------------------------------------------------------------

def _derive_record_zone(record: dict) -> str | None:
    """The machine's zone (A-D), used to SCOPE who may see a telemetry record.
    Prefer the explicit record['zone']; otherwise infer it from the machine name.
    This is the SINGLE source of truth shared by /telemetry/snapshot and the live
    WebSocket broadcast so the two channels enforce the SAME zone boundary."""
    rz = record.get("zone")
    if rz:
        return str(rz).upper()
    mach_name = record.get("Machine", "") or ""
    match = re.search(r'\b([A-D])[0-9]+\b', mach_name, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    mach = str(mach_name).lower()
    if any(k in mach for k in ("compressor", "pump", "motor")):
        return "A"
    if any(k in mach for k in ("distillation", "heat exchanger", "storage tank", "separator")):
        return "B"
    if any(k in mach for k in ("boiler", "generator", "control valve", "mcc panel")):
        return "C"
    if any(k in mach for k in ("reactor", "fired heater", "cooling tower", "flare")):
        return "D"
    if mach_name:
        return ["A", "B", "C", "D"][sum(ord(c) for c in mach_name) % 4]
    return None


class ConnectionManager:
    def __init__(self):
        # Each entry: (websocket, role, zone). role/zone come from the connecting
        # client's JWT claims and SCOPE what that connection is allowed to receive
        # (see broadcast). Defaults fail CLOSED (technician + no zone => sees only
        # its own zone, i.e. nothing unless matched).
        self.active: list[tuple[WebSocket, str, str | None]] = []

    async def connect(self, websocket: WebSocket, role: str = "technician",
                      zone: str | None = None):
        await websocket.accept()
        self.register(websocket, role, zone)

    def register(self, websocket: WebSocket, role: str = "technician",
                 zone: str | None = None):
        """Add an ALREADY-ACCEPTED socket to the broadcast set (used by the WS
        endpoint, which must accept first to read the auth handshake message)."""
        self.active.append((websocket, role, zone))

    def disconnect(self, websocket: WebSocket):
        self.active = [c for c in self.active if c[0] is not websocket]

    async def broadcast(self, record: dict):
        """Send one record (as JSON) to every client THAT IS ALLOWED TO SEE IT.

        Zone scoping MIRRORS /telemetry/snapshot: a plant_manager sees all zones;
        a field_manager/technician sees ONLY records in their own zone. SITE-WIDE
        emergencies (record['site_alert']) intentionally bypass zone scoping and
        reach everyone — a plant emergency must be visible to all roles. A dropped
        client must not kill the loop, so each send is isolated and failed clients
        are pruned afterwards."""
        payload = json.dumps(record)
        rec_zone = _derive_record_zone(record)
        site_wide = bool(record.get("site_alert"))
        dead: list[WebSocket] = []
        for ws, role, zone in list(self.active):
            if not (site_wide or role == "plant_manager" or zone == rec_zone):
                continue  # out of this connection's zone scope -> do not leak it
            try:
                await ws.send_text(payload)
            except Exception:
                # client vanished mid-send; mark for removal, keep going
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()

# Captured at startup so the MQTT thread can schedule coroutines onto it.
event_loop: asyncio.AbstractEventLoop | None = None

# Kept so we can stop the network loop cleanly on shutdown.
mqtt_client: mqtt.Client | None = None


# ----------------------------------------------------------------------
# MQTT callbacks (these run on paho's background thread, NOT asyncio)
# ----------------------------------------------------------------------

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[mqtt] connected to {config.MQTT_HOST}:{config.MQTT_PORT}")
        client.subscribe(config.MQTT_TOPIC)
        print(f"[mqtt] subscribed to {config.MQTT_TOPIC}")
    else:
        print(f"[mqtt] connect failed (rc={rc})")


def on_message(client, userdata, msg):
    try:
        raw = json.loads(msg.payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        print(f"[mqtt] skipping bad message on {msg.topic}: {exc}")
        return

    # The ONE normalization choke point.
    record = normalize(raw)

    # ---- Stage: anomaly — NexOps's OWN risk view, ADDED to the record -----
    # We AUGMENT, never replace: every original gateway field is kept; we only
    # add anomaly_score / anomaly_status / nexops_risk / nexops_reasoning.
    #
    # FAIL-SAFE: the entire ML step is wrapped in try/except. If anything goes
    # wrong, we attach a null score + a gateway-mirrored fallback risk and log
    # the error — the live feed must NEVER break because of the ML layer.
    try:
        # Gate the anomaly TRAINING append so a machine's OWN fault frames never
        # pollute its model of "normal". A reading is a fault per the gateway/sim
        # flags ONLY (never anomaly_score - that would be circular): predictive,
        # a Warning/Critical status, or High/Critical priority. The reading is
        # still SCORED; it just doesn't train when it's a fault.
        is_fault = (
            record.get("is_predictive") is True
            or str(record.get("Status", "") or "").lower() in ("warning", "critical")
            or str(record.get("alarm_priority", "") or "").lower() in ("high", "critical")
        )
        result = engine.update_and_score(record, is_training_eligible=not is_fault)
        risk = compute_nexops_risk(record, result["anomaly_score"])
        record["anomaly_score"] = result["anomaly_score"]   # None while warming up
        record["anomaly_status"] = result["status"]         # "warming_up" | "scored"
        record["nexops_risk"] = risk["nexops_risk"]
        record["nexops_reasoning"] = risk["reasoning"]
    except Exception as exc:
        fb = fallback_risk(record)
        record["anomaly_score"] = None
        record["anomaly_status"] = "error"
        record["nexops_risk"] = fb["nexops_risk"]
        record["nexops_reasoning"] = fb["reasoning"]
        print(f"[anomaly] scoring failed for "
              f"{record.get('Machine', '?')}: {exc} (feed continues)")

    # ---- Stage: EARLY flag — SINGLE SOURCE OF TRUTH (stamped on the wire) --
    # Compute the EARLY badge ONCE here, on the CAPPED nexops_risk above, and
    # broadcast it as `is_early`. The React app and test_ws.html both READ this
    # one boolean instead of re-deriving it (they used to drift). Faithful port
    # of the frontend isEarlyWarning (see is_early_record). FAIL-SAFE: any error
    # defaults is_early=False so a bad record never breaks the broadcast.
    try:
        record["is_early"] = is_early_record(record)
    except Exception as exc:
        record["is_early"] = False
        print(f"[is_early] flagging failed for {record.get('Machine', '?')}: {exc} "
              f"(feed continues)")

    # ---- Stage: assignment — route genuine faults to an engineer ----------
    # ADDITIVE + FAIL-SAFE. We attach assignment fields to the record; any DB or
    # scoring error falls back to "Unassigned" and NEVER blocks the broadcast or
    # the anomaly layer.
    #
    # THREAD/SESSION SAFETY: this runs on paho's background thread. We create a
    # SQLAlchemy session PER MESSAGE inside this handler and close it here, so a
    # session object is never shared across the thread boundary. The engine /
    # connection pool (and SQLite check_same_thread=False, set in db.py) make
    # the per-call session pattern safe.
    record["assigned_engineer"] = "Unassigned"
    record["assigned_engineer_id"] = None
    record["assignment_reason"] = None
    record["fault_category"] = None
    try:
        machine = record.get("Machine", "?")
        back_to_normal = (
            record.get("Status") == "Normal" or record.get("alarm_state") == "RTN"
        )

        if should_assign(record):
            category = fault_category_for(record)
            key = (machine, category)
            with _assign_lock:
                last_resolved = resolved_timestamps.get(key)
                is_cooling_down = (last_resolved is not None
                                   and time.time() - last_resolved < RESOLVE_COOLDOWN_SECONDS)
                cached = active_assignments.get(key)

            if is_cooling_down:
                # RECOVERY GRACE (re-assignment loop fix): the machine was just
                # resolved but the simulator heals on its OWN ~2-min timer, so it
                # keeps emitting the same fault. RE-ARM the window on every
                # suppressed tick (sliding window) so suppression lasts until the
                # warnings actually STOP or back_to_normal clears it — the cooldown
                # can never expire mid-recovery and spawn a duplicate.
                with _assign_lock:
                    resolved_timestamps[key] = time.time()
                result = {
                    "engineer_id": None,
                    "engineer_name": "Unassigned",
                    "reasoning": f"Suppressing duplicate {category} fault on {machine} (recovering after resolve)",
                    "fault_category": category,
                }
            elif cached is not None:
                # Same ongoing fault -> REUSE the engineer. No re-score, no
                # re-increment of load.
                result = cached
            else:
                # No in-memory dedupe entry yet (first frame this run, or after a
                # restart). Before creating a NEW task, check the DB for an already
                # OPEN task for this exact (machine, fault_category): a developing
                # fault re-emits every fleet sweep but is ONE physical fault. If one
                # is open, REUSE it (no duplicate row, no re-score, no re-increment
                # of load); only a resolved task frees the slot for a fresh
                # assignment. FAIL-SAFE: if the lookup errors, fall through to the
                # original assign+persist - we prefer a rare duplicate over DROPPING
                # a real fault.
                session = get_session()
                suppress = False
                try:
                    existing = None
                    try:
                        existing = find_open_assignment(session, machine, category)
                    except Exception as exc:
                        existing = None
                        print(f"[assignment] open-task lookup failed for "
                              f"{machine}/{category}: {exc} (creating task)")
                    if existing is not None:
                        # Duplicate suppressed: reuse the open task's engineer. We
                        # do NOT update the row (kept trivial/safe per de-dup spec).
                        result = {
                            "engineer_id": existing.engineer_id,
                            "engineer_name": existing.engineer_name,
                            "fault_category": existing.fault_category,
                            "score": existing.score,
                            "reasoning": (f"reusing open task #{existing.id} "
                                          f"(status {existing.status}) - duplicate "
                                          f"{category} fault on {machine} suppressed"),
                        }
                    else:
                        # RESTART-SAFE RECOVERY GRACE (re-assignment loop fix): the
                        # in-memory cooldown is lost on a backend restart, so also
                        # check the DB for a RECENTLY RESOLVED task for this (machine,
                        # category). If one resolved within the recovery window, the
                        # simulator is still healing the machine — SUPPRESS and re-seed
                        # the in-memory window instead of spawning a duplicate task.
                        recent = None
                        try:
                            recent = find_recent_resolved_assignment(
                                session, machine, category, RESOLVE_COOLDOWN_SECONDS)
                        except Exception as exc:
                            recent = None
                            print(f"[assignment] recent-resolved lookup failed for "
                                  f"{machine}/{category}: {exc} (creating task)")
                        if recent is not None:
                            suppress = True
                            result = {
                                "engineer_id": None,
                                "engineer_name": "Unassigned",
                                "reasoning": (f"Suppressing duplicate {category} fault on "
                                              f"{machine} (recently resolved #{recent.id}, recovering)"),
                                "fault_category": category,
                            }
                        else:
                            # New fault for this machine+category -> score + persist once.
                            result = assign_engineer(record, session)
                            record_assignment(record, result, session)
                finally:
                    session.close()
                with _assign_lock:
                    if suppress:
                        # Re-seed the sliding window so subsequent ticks take the
                        # fast in-memory cooldown path (no repeated DB lookups).
                        resolved_timestamps[key] = time.time()
                    else:
                        active_assignments[key] = result

            record["assigned_engineer"] = result.get("engineer_name") or "Unassigned"
            record["assigned_engineer_id"] = result.get("engineer_id")
            record["assignment_reason"] = result.get("reasoning")
            record["fault_category"] = result.get("fault_category") or category

        elif back_to_normal:
            # Machine recovered -> drop ALL its active assignments so the next
            # recurrence is treated as a brand-new fault and re-assigned.
            with _assign_lock:
                for stale in [k for k in active_assignments if k[0] == machine]:
                    active_assignments.pop(stale, None)
                for stale in [k for k in resolved_timestamps if k[0] == machine]:
                    resolved_timestamps.pop(stale, None)
    except Exception as exc:
        # Keep the defaults set above; never let the DB layer break the feed.
        record["assigned_engineer"] = "Unassigned"
        record["assigned_engineer_id"] = None
        record["assignment_reason"] = None
        print(f"[assignment] failed for {record.get('Machine', '?')}: {exc} "
              f"(feed continues)")

    # ---- Site-wide emergency tagging (ADDITIVE + FAIL-SAFE) ---------------
    # Critical/safety events (SAME detection that drove the capacity bypass) are
    # SITE-WIDE emergencies: the UI uses site_alert to trigger a red-zone alert
    # visible to ALL roles (plant manager, engineer, technician). Nuisance /
    # filterable noise is NEVER a site alert. On any error we default to a calm
    # (non-emergency) tag so the live feed keeps flowing.
    record["site_alert"] = False
    record["alert_scope"] = "normal"
    record["emergency_type"] = None
    try:
        if not record.get("is_nuisance") and is_safety_critical(record):
            record["site_alert"] = True
            record["alert_scope"] = "site"
            record["emergency_type"] = emergency_type_for(record)
    except Exception as exc:
        record["site_alert"] = False
        record["alert_scope"] = "normal"
        record["emergency_type"] = None
        print(f"[site_alert] tagging failed for {record.get('Machine', '?')}: {exc} "
              f"(feed continues)")

    # ---- Later-stage insertion points (NOT implemented in this task) ----
    # TODO(Stage: history) write record to InfluxDB here
    # TODO(Stage: ARIA) attach ARIA explanation here
    # ---------------------------------------------------------------------

    # Store the latest record for this machine in our thread-safe cache
    if "Machine" in record:
        with _states_lock:
            latest_machine_states[record["Machine"]] = record
            if record["Machine"] not in history_machine_states:
                history_machine_states[record["Machine"]] = deque(maxlen=50)
            history_machine_states[record["Machine"]].append(record.copy())

    # Hand off from this sync MQTT thread to the asyncio event loop.
    if event_loop is not None:
        asyncio.run_coroutine_threadsafe(manager.broadcast(record), event_loop)


# ----------------------------------------------------------------------
# FastAPI lifecycle: start/stop the MQTT network loop
# ----------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    global event_loop, mqtt_client
    # Capture the loop the WebSocket sends must run on.
    event_loop = asyncio.get_running_loop()

    # --- Assignment subsystem: ensure the DB exists and has a roster. ---
    # Create tables if absent, then seed the demo roster ONLY if empty (so we
    # don't wipe an existing DB on every restart). Fail-safe: if this errors,
    # the bridge still runs; assignment simply falls back to "Unassigned".
    try:
        init_db()
        s = get_session()
        try:
            count = s.query(Engineer).count()
        finally:
            s.close()
        if count == 0:
            seed()  # wipe-and-fill demo roster (opens/closes its own session)
            print("[assignment] empty DB -> seeded demo roster")
        else:
            print(f"[assignment] DB ready ({count} engineers) -> skip seeding")
    except Exception as exc:
        print(f"[assignment] DB init/seed failed: {exc} "
              f"(assignments will fall back to Unassigned)")

    mqtt_client = mqtt.Client()
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    mqtt_client.reconnect_delay_set(min_delay=1, max_delay=30)
    try:
        mqtt_client.connect(config.MQTT_HOST, config.MQTT_PORT)
    except Exception as exc:
        # Don't crash the API if the broker isn't up yet; paho will retry
        # once it can reach the host.
        print(f"[mqtt] initial connect to {config.MQTT_HOST}:{config.MQTT_PORT} "
              f"failed: {exc} (will keep retrying)")
    # Run paho's network loop on its own background thread.
    mqtt_client.loop_start()


@app.on_event("shutdown")
async def shutdown():
    if mqtt_client is not None:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()


# ----------------------------------------------------------------------
# HTTP + WebSocket endpoints
# ----------------------------------------------------------------------

@app.get("/")
async def health():
    """Simple health check - open in a browser to confirm the service is up."""
    return {"status": "ok", "clients": len(manager.active)}


@app.get("/telemetry/snapshot")
def get_telemetry_snapshot(current: CurrentUser = Depends(get_current_user)):
    """Return the latest telemetry record for each machine.

    Stage 3b: Requires a valid JWT token. Plant managers see all records;
    field managers and technicians see only records in their zone.
    """
    with _states_lock:
        records = list(latest_machine_states.values())

    if current.role == "plant_manager":
        return records

    # Same zone boundary as the live WebSocket feed (shared _derive_record_zone).
    return [r for r in records if _derive_record_zone(r) == current.zone]


# ----------------------------------------------------------------------
# Task lifecycle endpoints (the NEW browser -> backend direction).
#
# These are SYNC `def` path operations on purpose: FastAPI runs sync endpoints
# in a worker threadpool, so each request gets its OWN thread AND its OWN
# short-lived DB session (created here, closed in finally). A session object is
# never shared across requests or with the MQTT callback thread - same per-call
# safety as on_message(). Errors return a clean JSON body + status code and can
# never crash the bridge or the MQTT loop.
# ----------------------------------------------------------------------

@app.post("/tasks/{assignment_id}/start")
def http_start_task(assignment_id: int,
                    current: CurrentUser = Depends(get_current_user)):
    """assigned -> in_progress. Returns the updated task summary.

    Stage 3b: REQUIRES a token. A technician may start ONLY his own task; a
    field_manager only tasks whose engineer is in his zone; plant any. A
    scoped-out write returns 403 (distinct from 401 no-token / 404 not-found)."""
    session = get_session()
    try:
        a = session.get(Assignment, assignment_id)
        if a is None:
            return JSONResponse(status_code=404,
                                content={"error": f"assignment {assignment_id} not found"})
        if not can_write_assignment(a, current, session):
            return JSONResponse(status_code=403,
                                content={"error": "forbidden: task is outside your scope"})
        return start_task(assignment_id, session)
    except LookupError as exc:
        return JSONResponse(status_code=404, content={"error": str(exc)})
    except ValueError as exc:
        return JSONResponse(status_code=409, content={"error": str(exc)})
    except Exception as exc:  # never let a DB error crash the bridge
        print(f"[tasks] start failed for {assignment_id}: {exc}")
        return JSONResponse(status_code=500, content={"error": "internal error"})
    finally:
        session.close()


@app.post("/tasks/{assignment_id}/resolve")
def http_resolve_task(assignment_id: int,
                      current: CurrentUser = Depends(get_current_user)):
    """-> resolved. Decrements the engineer's active_tasks (frees capacity) and
    clears the in-memory dedupe entry so the same fault can re-assign if it
    recurs. Returns the summary incl. engineer_active_tasks (freed capacity).

    Stage 3b: REQUIRES a token. Same write scope as /start — technician own task
    only, field_manager in-zone only, plant any; out-of-scope -> 403."""
    session = get_session()
    try:
        a = session.get(Assignment, assignment_id)
        if a is None:
            return JSONResponse(status_code=404,
                                content={"error": f"assignment {assignment_id} not found"})
        if not can_write_assignment(a, current, session):
            return JSONResponse(status_code=403,
                                content={"error": "forbidden: task is outside your scope"})
        summary = resolve_task(assignment_id, session)
        # Free the dedupe slot for this machine+fault so a recurrence re-assigns.
        cleared = clear_dedupe_for(summary.get("machine"), summary.get("fault_category"))
        summary["dedupe_cleared"] = cleared
        return summary
    except LookupError as exc:
        return JSONResponse(status_code=404, content={"error": str(exc)})
    except ValueError as exc:
        return JSONResponse(status_code=409, content={"error": str(exc)})
    except Exception as exc:  # never let a DB error crash the bridge
        print(f"[tasks] resolve failed for {assignment_id}: {exc}")
        return JSONResponse(status_code=500, content={"error": "internal error"})
    finally:
        session.close()


@app.get("/tasks")
def http_list_tasks(include_resolved: bool = False,
                    current: CurrentUser = Depends(get_current_user)):
    """The technician's open queue (non-resolved). ?include_resolved=true also
    returns resolved tasks.

    Stage 3b: REQUIRES a token and SCOPES the result by role+zone —
    plant_manager sees all zones, field_manager only his zone, technician only
    his own tasks (rule in scoping.scope_assignment_query)."""
    session = get_session()
    try:
        return get_active_assignments(
            session, include_resolved=include_resolved, current_user=current
        )
    except Exception as exc:  # never let a DB error crash the bridge
        print(f"[tasks] list failed: {exc}")
        return JSONResponse(status_code=500, content={"error": "internal error"})
    finally:
        session.close()


@app.get("/engineers/{engineer_id}/stats")
def http_engineer_stats(engineer_id: int,
                        current: CurrentUser = Depends(get_current_user)):
    """HONEST per-engineer stats for the technician console — only metrics the DB
    actually supports, never fabricated.

    Returns: { engineer_id, name, zone, resolved_count, active_count,
               avg_resolution_minutes }.
      - resolved_count : assignments with status='resolved' (the terminal state).
      - active_count   : assignments with status in ('assigned','in_progress').
      - avg_resolution_minutes : the mean of Assignment.resolution_minutes over
        this engineer's RESOLVED tasks (a REAL stored timestamp delta computed by
        lifecycle.resolve_task from resolved_at - assigned_at). It is null when
        the engineer has no resolved task yet — NOT faked.

    SCOPING reuses scoping.scope_engineer_query (NOT a new rule): plant any,
    field_manager only engineers in his zone, technician only HIMSELF. We look the
    engineer up unscoped first (404 if truly absent), then through the scoped
    query (403 if it exists but is outside the caller's scope). REQUIRES a token
    (get_current_user -> 401). Fail-safe: any error -> clean 500 body, no leak."""
    session = get_session()
    try:
        # 404 ONLY when the engineer genuinely does not exist.
        engineer = session.get(Engineer, engineer_id)
        if engineer is None:
            return JSONResponse(status_code=404,
                                content={"error": f"engineer {engineer_id} not found"})

        # SAME role/zone rule as everywhere else: reuse scope_engineer_query. If the
        # engineer exists but the scoped query can't see it -> out of scope (403).
        visible = (
            scope_engineer_query(
                session.query(Engineer).filter(Engineer.id == engineer_id), current
            ).first()
            is not None
        )
        if not visible:
            return JSONResponse(status_code=403,
                                content={"error": "forbidden: engineer outside your scope"})

        rows = (
            session.query(Assignment)
            .filter(Assignment.engineer_id == engineer_id)
            .all()
        )
        resolved = [a for a in rows if a.status == "resolved"]
        active_count = sum(1 for a in rows if a.status in ("assigned", "in_progress"))
        mins = [a.resolution_minutes for a in resolved if a.resolution_minutes is not None]
        avg_resolution_minutes = round(sum(mins) / len(mins), 2) if mins else None

        return {
            "engineer_id": engineer.id,
            "name": engineer.name,
            "zone": engineer.zone,
            "resolved_count": len(resolved),
            "active_count": active_count,
            "avg_resolution_minutes": avg_resolution_minutes,
        }
    except Exception as exc:  # never let a DB error crash the bridge
        print(f"[stats] engineer {engineer_id} failed: {exc}")
        return JSONResponse(status_code=500, content={"error": "internal error"})
    finally:
        session.close()


# ----------------------------------------------------------------------
# Employee management (Stage 3d) — PLANT MANAGER ONLY for the mutating routes.
# Add a technician (Engineer + linked User in ONE transaction) and SOFT-DELETE
# (deactivate/activate) without touching assignment history. GET /engineers
# REUSES scope_engineer_query (no new rule). Fail-safe throughout.
# ----------------------------------------------------------------------

_VALID_ZONES = ("A", "B", "C", "D")


class CreateEngineerRequest(BaseModel):
    name: str
    zone: str
    skills: list[str] = []
    max_capacity: int | None = None
    role: str | None = None
    username: str | None = None
    password: str | None = None


def _require_plant(current):
    """Plant-manager-only gate for mutating employee routes. Returns a 403
    JSONResponse when the caller is not a plant_manager, else None."""
    if getattr(current, "role", None) != "plant_manager":
        return JSONResponse(status_code=403, content={"error": "forbidden: plant manager only"})
    return None


def _unique_username(session, base, zone, engineer_id):
    """seed.py-style collision-safe username: lowercased first name, then +zone,
    then +id. Checks existing User.username rows so it never collides."""
    def taken(u):
        return session.query(User).filter(User.username == u).first() is not None
    cand = base
    if taken(cand):
        cand = f"{base}{(zone or '').lower()}"
    if taken(cand):
        cand = f"{base}{engineer_id}"
    return cand


@app.get("/engineers")
def http_list_engineers(current: CurrentUser = Depends(get_current_user)):
    """Roster source for the UI. SCOPED via scope_engineer_query (NOT a new rule):
    plant sees all, field_manager his zone, technician himself. Includes `active`."""
    session = get_session()
    try:
        q = scope_engineer_query(session.query(Engineer), current)
        return [
            {
                "id": e.id, "name": e.name, "zone": e.zone, "role": e.role,
                "skills": e.skills or [], "max_capacity": e.max_capacity,
                "active_tasks": e.active_tasks, "available": e.available,
                "active": e.active,
            }
            for e in q.order_by(Engineer.id).all()
        ]
    except Exception as exc:  # never let a DB error crash the bridge
        print(f"[engineers] list failed: {exc}")
        return JSONResponse(status_code=500, content={"error": "internal error"})
    finally:
        session.close()


@app.post("/engineers", status_code=201)
def http_create_engineer(body: CreateEngineerRequest,
                         current: CurrentUser = Depends(get_current_user)):
    """PLANT ONLY. Create an Engineer (active=True) AND a linked technician User
    in ONE transaction — rollback on any error so a half-created pair never
    persists. 400 on bad zone / duplicate username; 403 non-plant; 401 no token."""
    denied = _require_plant(current)
    if denied is not None:
        return denied

    name = (body.name or "").strip()
    if not name:
        return JSONResponse(status_code=400, content={"error": "name is required"})
    zone = (body.zone or "").strip().upper()
    if zone not in _VALID_ZONES:
        return JSONResponse(status_code=400, content={"error": f"zone must be one of {list(_VALID_ZONES)}"})
    if not isinstance(body.skills, list):
        return JSONResponse(status_code=400, content={"error": "skills must be a list"})

    session = get_session()
    try:
        # Explicit username: reject a duplicate up front with a clear 400.
        uname = None
        if body.username:
            uname = body.username.strip().lower()
            if not uname:
                return JSONResponse(status_code=400, content={"error": "username is empty"})
            if session.query(User).filter(User.username == uname).first() is not None:
                return JSONResponse(status_code=400, content={"error": f"username '{uname}' already exists"})

        engineer = Engineer(
            name=name,
            role=(body.role or "Field Technician"),
            skills=list(body.skills),
            zone=zone,
            max_capacity=(body.max_capacity if body.max_capacity is not None else 6),
            active_tasks=0,
            available=True,
            experience_years=0,
            active=True,
        )
        session.add(engineer)
        session.flush()  # assign engineer.id within the SAME transaction

        if uname is None:
            base = (name.split()[0] if name.split() else f"eng{engineer.id}").lower()
            uname = _unique_username(session, base, zone, engineer.id)

        pw = body.password if body.password else DEV_PASSWORD
        user = User(
            username=uname,
            password_hash=hash_password(pw),
            role="technician",
            zone=zone,
            engineer_id=engineer.id,
            active=True,
        )
        session.add(user)
        session.commit()

        return {
            "engineer": {
                "id": engineer.id, "name": engineer.name, "zone": engineer.zone,
                "role": engineer.role, "skills": engineer.skills,
                "max_capacity": engineer.max_capacity, "active": engineer.active,
            },
            "user": {
                "username": user.username, "role": user.role, "zone": user.zone,
                "engineer_id": user.engineer_id, "active": user.active,
            },
            "password_is_default": body.password is None,
        }
    except Exception as exc:
        session.rollback()  # never persist a half-created engineer+user pair
        print(f"[engineers] create failed: {exc}")
        return JSONResponse(status_code=500, content={"error": "internal error"})
    finally:
        session.close()


def _set_engineer_active(engineer_id, active, current):
    """Shared body for activate/deactivate (PLANT ONLY). Sets Engineer.active and
    mirrors it onto the linked user(s). Idempotent. 404 if the engineer is missing.
    Soft only — no rows deleted, so assignment history is preserved.

    DEACTIVATION: when active=False, all OPEN tasks (assigned/in_progress) for
    this engineer are UNASSIGNED (engineer_id set to NULL, engineer_name to
    'Unassigned') so they enter the unassigned pool for field managers to
    manually reassign. active_tasks is zeroed out."""
    denied = _require_plant(current)
    if denied is not None:
        return denied
    session = get_session()
    try:
        engineer = session.get(Engineer, engineer_id)
        if engineer is None:
            return JSONResponse(status_code=404, content={"error": f"engineer {engineer_id} not found"})
        engineer.active = active
        for u in session.query(User).filter(User.engineer_id == engineer_id).all():
            u.active = active
            if not active:
                # Force-logout: invalidate the deactivated user's outstanding JWTs
                # so reactivation later can't revive an old session either.
                u.token_version = int(getattr(u, "token_version", 0) or 0) + 1

        session.flush()

        unassigned_count = 0
        if not active:
            # Reassign all open tasks from this engineer.
            # If a suitable engineer has capacity, auto-reassign it.
            # Otherwise, unassign it so it goes to the unassigned pool.
            open_tasks = (
                session.query(Assignment)
                .filter(Assignment.engineer_id == engineer_id)
                .filter(Assignment.status.in_(("assigned", "in_progress")))
                .all()
            )
            for task in open_tasks:
                try:
                    record = {
                        "Machine": task.machine,
                        "zone": task.zone,
                        "alarm_id": task.alarm_id,
                        "alarm_type": task.fault_category,
                        "Alert": task.fault_category,
                        "message": task.fault_category,
                    }
                    res = assign_engineer(record, session)
                    if res.get("assigned"):
                        task.engineer_id = res["engineer_id"]
                        task.engineer_name = res["engineer_name"]
                        task.status = "assigned"
                        task.started_at = None
                        task.score = res.get("score")
                        new_eng = session.get(Engineer, res["engineer_id"])
                        if new_eng:
                            new_eng.active_tasks = (new_eng.active_tasks or 0) + 1
                    else:
                        task.engineer_id = None
                        task.engineer_name = "Unassigned"
                        task.status = "assigned"
                        task.started_at = None
                        unassigned_count += 1
                except Exception as exc:
                    print(f"[deactivation-rotation] failed for task #{task.id}: {exc}")
                    task.engineer_id = None
                    task.engineer_name = "Unassigned"
                    task.status = "assigned"
                    task.started_at = None
                    unassigned_count += 1
            # Zero out active_tasks since all open tasks are now reassigned or unassigned
            engineer.active_tasks = 0

        session.commit()
        result = {"engineer_id": engineer.id, "name": engineer.name, "active": engineer.active}
        if not active:
            result["tasks_unassigned"] = unassigned_count
        return result
    except Exception as exc:
        session.rollback()
        print(f"[engineers] set-active({active}) {engineer_id} failed: {exc}")
        return JSONResponse(status_code=500, content={"error": "internal error"})
    finally:
        session.close()


@app.post("/engineers/{engineer_id}/deactivate")
def http_deactivate_engineer(engineer_id: int,
                             current: CurrentUser = Depends(get_current_user)):
    """PLANT ONLY. Soft-delete: Engineer.active=False (excluded from assignment
    eligibility), rows preserved. Idempotent. 404 if missing."""
    return _set_engineer_active(engineer_id, False, current)


@app.post("/engineers/{engineer_id}/activate")
def http_activate_engineer(engineer_id: int,
                           current: CurrentUser = Depends(get_current_user)):
    """PLANT ONLY. Reverse of deactivate (demo reset). Idempotent. 404 if missing."""
    return _set_engineer_active(engineer_id, True, current)


@app.delete("/engineers/{engineer_id}")
def http_delete_engineer(engineer_id: int,
                         current: CurrentUser = Depends(get_current_user)):
    """PLANT ONLY. Hard-delete: permanently removes the Engineer and linked User
    rows from the database. Assignment history (Assignment rows) referencing this
    engineer is also removed. Use deactivate for temporary absences instead."""
    denied = _require_plant(current)
    if denied is not None:
        return denied
    session = get_session()
    try:
        engineer = session.get(Engineer, engineer_id)
        if engineer is None:
            return JSONResponse(status_code=404, content={"error": f"engineer {engineer_id} not found"})
        # Remove linked User rows first (FK constraint)
        session.query(User).filter(User.engineer_id == engineer_id).delete()
        # Remove assignment rows referencing this engineer
        session.query(Assignment).filter(Assignment.engineer_id == engineer_id).delete()
        session.delete(engineer)
        session.commit()
        return {"deleted": True, "engineer_id": engineer_id}
    except Exception as exc:
        session.rollback()
        print(f"[engineers] delete {engineer_id} failed: {exc}")
        return JSONResponse(status_code=500, content={"error": "internal error"})
    finally:
        session.close()



class AssignTaskRequest(BaseModel):
    engineer_id: int


@app.post("/tasks/{assignment_id}/assign")
def http_assign_task(assignment_id: int, body: AssignTaskRequest,
                    current: CurrentUser = Depends(get_current_user)):
    """Manually assign an unassigned task to an engineer. Allowed for
    plant_manager (any) and field_manager (zone-scoped). The task must be
    unassigned (engineer_id is NULL). The target engineer must be active and
    in the caller's zone (for field_manager). Increments the engineer's
    active_tasks."""
    role = getattr(current, "role", None)
    if role not in ("plant_manager", "field_manager"):
        return JSONResponse(status_code=403, content={"error": "forbidden: managers only"})

    session = get_session()
    try:
        task = session.get(Assignment, assignment_id)
        if task is None:
            return JSONResponse(status_code=404, content={"error": f"task {assignment_id} not found"})

        # Only unassigned tasks can be manually assigned
        if task.engineer_id is not None:
            return JSONResponse(status_code=409, content={"error": "task is already assigned to an engineer"})

        engineer = session.get(Engineer, body.engineer_id)
        if engineer is None:
            return JSONResponse(status_code=404, content={"error": f"engineer {body.engineer_id} not found"})
        if not engineer.active:
            return JSONResponse(status_code=400, content={"error": "cannot assign to a deactivated engineer"})

        # Zone scoping for field_manager
        if role == "field_manager":
            caller_zone = getattr(current, "zone", None)
            if not caller_zone:
                return JSONResponse(status_code=403, content={"error": "field manager has no zone"})
            # The task must be in the field manager's zone
            if task.zone and task.zone != caller_zone:
                return JSONResponse(status_code=403, content={"error": "task is not in your zone"})
            # The engineer must be in the field manager's zone
            if engineer.zone != caller_zone:
                return JSONResponse(status_code=403, content={"error": "engineer is not in your zone"})

        # Assign the task
        task.engineer_id = engineer.id
        task.engineer_name = engineer.name
        task.status = "assigned"
        engineer.active_tasks = (engineer.active_tasks or 0) + 1

        session.commit()
        session.refresh(task)

        return {
            "id": task.id,
            "machine": task.machine,
            "zone": task.zone,
            "fault_category": task.fault_category,
            "engineer_id": task.engineer_id,
            "engineer_name": task.engineer_name,
            "status": task.status,
        }
    except Exception as exc:
        session.rollback()
        print(f"[tasks] assign {assignment_id} failed: {exc}")
        return JSONResponse(status_code=500, content={"error": "internal error"})
    finally:
        session.close()


# ----------------------------------------------------------------------
# Auth endpoints (Stage 3a foundation). ADDITIVE: these add a login + identity
# surface but GATE NOTHING — every existing route and the WebSocket feed stay
# reachable WITHOUT a token. Data scoping by role/zone arrives in Stage 3b.
# ----------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


# An IP literal only ever contains these characters (IPv4 dotted-quad or IPv6
# incl. zone id). We use this to SANITIZE the value before it is used as a rate-
# limit key or written to a log line — X-Forwarded-For is attacker-controlled, so
# without this a CRLF-laced header could forge log entries (log injection).
_IP_CHARS_RE = re.compile(r"[^0-9a-fA-F:.%]")


def _sanitize_ip(value: str) -> str:
    cleaned = _IP_CHARS_RE.sub("", value or "")[:45]  # 45 = max IPv6 text length
    return cleaned or "unknown"


def _client_ip(request: Request) -> str:
    """Resolve the real client IP for login throttling. Behind a TRUSTED reverse
    proxy (config.TRUST_PROXY=1) the direct peer is the proxy, so we take the
    left-most X-Forwarded-For entry (the original client); otherwise we use the
    direct peer. X-Forwarded-For is NOT trusted by default (it is client-spoofable
    unless a trusted proxy sets it), so per-IP limits stay meaningful in dev. The
    result is SANITIZED to IP characters only, so an attacker-controlled header can
    never inject into the rate-limit key or the auth log lines."""
    if config.TRUST_PROXY:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            first = xff.split(",")[0].strip()
            if first:
                return _sanitize_ip(first)
    return _sanitize_ip(request.client.host) if request.client else "unknown"


@app.post("/auth/login")
def auth_login(body: LoginRequest, request: Request, response: Response):
    """Verify {username, password} -> issue a JWT.

    Security hardening applied:
    - Rate-limited per IP (10 failures / 5 min) and per username (5 failures / 5 min).
      Exceeded threshold triggers a 15-minute lockout -> 429.
    - Inactive accounts are rejected (same 401 as bad credentials — no info leak).
    - Successful login clears the rate-limit counters for that IP + username.
    - Sets the httpOnly session cookie + readable CSRF cookie (browser model). The
      token is ALSO returned in the body for non-browser clients (tests / tools).
    """
    client_ip = _client_ip(request)
    uname = (body.username or "").strip().lower()

    # Rate-limit check — before touching the DB.
    allowed, reason = check_rate_limit(client_ip, uname)
    if not allowed:
        print(f"[auth] rate-limited login for {uname!r} from {client_ip}")
        return JSONResponse(status_code=429, content={"error": reason})

    session = get_session()
    try:
        user = session.query(User).filter(func.lower(User.username) == uname).first()
        # Unified 401: bad username, wrong password, OR deactivated account.
        # Never reveal which condition failed.
        active = getattr(user, "active", True)  # default True for plant_manager rows
        if user is None or not active or not verify_password(body.password, user.password_hash):
            record_failed_attempt(client_ip, uname)
            print(f"[auth] failed login for {uname!r} from {client_ip}")
            return JSONResponse(status_code=401, content={"error": "invalid credentials"})

        clear_rate_limit(client_ip, uname)
        token = create_token(user)
        _set_auth_cookies(response, token)  # browser session (httpOnly + CSRF)
        print(f"[auth] successful login for {uname!r} ({user.role}) from {client_ip}")
        return {
            "token": token,
            "user": {
                "username": user.username,
                "role": user.role,
                "zone": user.zone,
                "engineer_id": user.engineer_id,
            },
        }
    except Exception as exc:
        print(f"[auth] login error for {uname!r}: {exc}")
        return JSONResponse(status_code=500, content={"error": "internal error"})
    finally:
        session.close()


@app.get("/auth/me")
def auth_me(current: CurrentUser = Depends(get_current_user)):
    """Resolve the Bearer token to the current user. This is the Stage 3a
    verification endpoint. 401 (via get_current_user) on missing/invalid/expired."""
    return {
        "id": current.id,
        "username": current.username,
        "role": current.role,
        "zone": current.zone,
        "engineer_id": current.engineer_id,
    }


@app.post("/auth/logout")
def auth_logout(response: Response, current: CurrentUser = Depends(get_current_user)):
    """REAL server-side logout: bump the user's token_version so EVERY
    outstanding JWT for this account is immediately invalidated — not just the one
    the client is holding (so a leaked/stolen token dies on logout too) — and clear
    the browser auth cookies. Requires a valid token; always 200 even if the
    revoke write fails."""
    session = get_session()
    try:
        revoke_user_tokens(session, current.id)
    except Exception as exc:
        print(f"[auth] logout revoke failed for {current.username!r}: {exc}")
    finally:
        session.close()
    _clear_auth_cookies(response)
    return {"status": "ok", "detail": "token revoked server-side"}


@app.get("/auth/ws-ticket")
def auth_ws_ticket(current: CurrentUser = Depends(get_current_user)):
    """Mint a SHORT-LIVED WebSocket ticket for the authenticated session. The SPA
    fetches this (cookie-authed, same-origin) and passes it as the WS first
    message, since the httpOnly cookie can't be attached to a cross-origin WS
    handshake. GET + read-only, so no CSRF needed."""
    session = get_session()
    try:
        u = session.get(User, current.id)
        ticket = create_ws_ticket(u) if u is not None else None
    finally:
        session.close()
    if not ticket:
        return JSONResponse(status_code=401, content={"error": "no session"})
    return {"ticket": ticket}


class AriaAskRequest(BaseModel):
    query: str


class AriaResponseEvidence(BaseModel):
    focus_machine: str | None = None
    nexops_risk: str = "LOW"
    anomaly_status: str | None = None
    time_to_threshold: dict | None = None
    assigned_engineer: str = "Unassigned"
    assignment_reason: str | None = None
    incident_matches: int = 0


class AriaResponse(BaseModel):
    answer: str
    source: str
    evidence: AriaResponseEvidence


@app.post("/aria/ask", response_model=AriaResponse)
async def http_aria_ask(body: AriaAskRequest, current: CurrentUser = Depends(get_current_user)):
    """
    ARIA Chatbot endpoint. Enforces zone-based scoping for technicians and field managers.
    """
    session = get_session()
    try:
        # Obtain latest states and history
        with _states_lock:
            latest = dict(latest_machine_states)
            history = {m: list(h) for m, h in history_machine_states.items()}
        
        # Call the aria helper
        res = await aria.answer(
            query=body.query,
            role=current.role,
            scope_zone=current.zone,
            latest=latest,
            history=history,
            session=session,
            username=current.username,
            engineer_id=current.engineer_id
        )
        return res
    except Exception as exc:
        print(f"[aria] ask failed: {exc}")
        return {
            "answer": "(Offline Fallback Mode — please check API key configuration)\n\nAn unexpected error occurred in the ARIA pipeline. Please try again later.",
            "source": "unavailable",
            "evidence": {
                "focus_machine": None,
                "nexops_risk": "LOW",
                "anomaly_status": None,
                "time_to_threshold": None,
                "assigned_engineer": "Unassigned",
                "assignment_reason": None,
                "incident_matches": 0
            }
        }
    finally:
        session.close()


def _extract_ws_token(message: str) -> str | None:
    """Pull the JWT from the WS auth handshake first-message: either a JSON
    envelope {"type":"auth","token":"<jwt>"} or a bare token string."""
    if not message:
        return None
    msg = message.strip()
    try:
        obj = json.loads(msg)
        if isinstance(obj, dict):
            tok = obj.get("token")
            return tok if isinstance(tok, str) and tok else None
    except Exception:
        pass
    # Bare token string: accept only if it LOOKS like a JWT (header.payload.sig).
    return msg if msg.count(".") == 2 else None


# Seconds to wait for the WS auth handshake before giving up (avoids a hung,
# never-authenticated socket holding a connection open).
_WS_AUTH_TIMEOUT_S = 10


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Authenticated WebSocket telemetry feed.

    The JWT is sent as the FIRST message after the socket opens — either a JSON
    envelope {"type":"auth","token":"<jwt>"} or a bare token string — so it never
    appears in the URL/query string (which would leak the credential into server
    access logs, proxy logs, and browser history). A legacy ?token=<jwt> query
    param is still accepted as a fallback for non-browser clients. Closes with
    code 4001 (missing/timed-out token) or 4003 (invalid/expired token) so the
    frontend can distinguish auth failures from network errors.
    """
    await websocket.accept()

    token = websocket.query_params.get("token")  # legacy / non-browser fallback
    if not token:
        try:
            first = await asyncio.wait_for(
                websocket.receive_text(), timeout=_WS_AUTH_TIMEOUT_S)
            token = _extract_ws_token(first)
        except Exception:
            # Timeout, disconnect, or malformed handshake -> treat as missing.
            token = None

    if not token:
        await websocket.close(code=4001, reason="authentication required")
        return
    claims = decode_token(token)
    if not claims:
        await websocket.close(code=4003, reason="invalid or expired token")
        return

    # SCOPE the live feed by the token's role + zone (mirrors /telemetry/snapshot).
    # Default fails CLOSED to a zone-less technician if claims are malformed.
    role = claims.get("role") or "technician"
    zone = claims.get("zone")
    manager.register(websocket, role=role, zone=zone)  # already accepted above
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.WS_HOST, port=config.WS_PORT)
