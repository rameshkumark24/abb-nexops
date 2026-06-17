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
import json
import os
import sys
import threading

# Make local modules (config.py, adapter.py) resolve no matter how the app is
# launched - `uvicorn main:app`, `python -m uvicorn main:app`, or from any CWD.
# We put THIS file's own directory on sys.path before the local imports below.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import paho.mqtt.client as mqtt
from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

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
)
from lifecycle import start_task, resolve_task, get_active_assignments
from db import Engineer, User, get_session, init_db
from seed import seed
# Stage 3a auth foundation (additive — gates NOTHING existing yet).
from auth_jwt import verify_password, create_token, get_current_user, CurrentUser

app = FastAPI(title="NexOps MQTT->WebSocket Bridge")

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
_assign_lock = threading.Lock()


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

      - is_nuisance is True            -> False (noise is never EARLY)
      - is_predictive is True          -> RISK_INDEX[nexops_risk] > gateway idx
                                          (predictive divergence; full strength)
      - else (anomaly-only)            -> gateway_calm AND RISK_INDEX >= MEDIUM

    FAIL-SAFE: missing is_predictive -> not predictive; missing nexops_risk ->
    LOW -> not early; missing is_nuisance -> not nuisance.
    """
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

# CORS: allow all origins for the demo so the Next.js app on :3000 can hit
# the HTTP/WS endpoints on :8000 without preflight headaches.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------------------------
# Connection manager: tracks live WebSocket clients and fans out records.
# ----------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active:
            self.active.remove(websocket)

    async def broadcast(self, record: dict):
        """Send one record (as JSON) to every client. A dropped client must
        not kill the loop, so each send is isolated; failed clients are
        pruned afterwards."""
        payload = json.dumps(record)
        dead: list[WebSocket] = []
        for ws in list(self.active):
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
                cached = active_assignments.get(key)

            if cached is not None:
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
                        # New fault for this machine+category -> score + persist once.
                        result = assign_engineer(record, session)
                        record_assignment(record, result, session)
                finally:
                    session.close()
                with _assign_lock:
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
def http_start_task(assignment_id: int):
    """assigned -> in_progress. Returns the updated task summary."""
    session = get_session()
    try:
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
def http_resolve_task(assignment_id: int):
    """-> resolved. Decrements the engineer's active_tasks (frees capacity) and
    clears the in-memory dedupe entry so the same fault can re-assign if it
    recurs. Returns the summary incl. engineer_active_tasks (freed capacity)."""
    session = get_session()
    try:
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
def http_list_tasks(include_resolved: bool = False):
    """The technician's open queue (non-resolved). ?include_resolved=true also
    returns resolved tasks."""
    session = get_session()
    try:
        return get_active_assignments(session, include_resolved=include_resolved)
    except Exception as exc:  # never let a DB error crash the bridge
        print(f"[tasks] list failed: {exc}")
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


@app.post("/auth/login")
def auth_login(body: LoginRequest):
    """Verify {username, password} -> issue a JWT. 401 on unknown user or bad
    password (no detail leak about which). Demo: NO rate-limit / lockout — that
    is future hardening. Never 500s on a bad credential."""
    session = get_session()
    try:
        user = session.query(User).filter(User.username == body.username).first()
        if user is None or not verify_password(body.password, user.password_hash):
            return JSONResponse(status_code=401, content={"error": "invalid credentials"})
        token = create_token(user)
        return {
            "token": token,
            "user": {"username": user.username, "role": user.role, "zone": user.zone},
        }
    except Exception as exc:  # never let a DB error crash the bridge
        print(f"[auth] login failed for {body.username!r}: {exc}")
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
def auth_logout():
    """JWT is stateless: there is nothing to invalidate server-side, so the
    client simply DROPS the token. No server blacklist for the demo (a future
    hardening step if token revocation is ever needed). Always 200."""
    return {"status": "ok", "detail": "client should discard the token"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # We only push to the browser; we don't expect inbound messages, but
        # we must keep reading so disconnects are detected promptly.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.WS_HOST, port=config.WS_PORT)
