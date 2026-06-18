"""
Task LIFECYCLE for the engineer-assignment subsystem.

A persisted Assignment moves through:  assigned -> in_progress -> resolved.

  - start_task   : assigned -> in_progress (stamps started_at)
  - resolve_task : -> resolved (stamps resolved_at, computes resolution_minutes,
                   and DECREMENTS the engineer's active_tasks to FREE capacity)
  - get_active_assignments : list non-resolved tasks for the technician queue

These are the COUNTERPART to assignment.record_assignment (which increments
active_tasks on a new assignment). Net effect: capacity rises on assign, falls on
resolve, so the plant can reach equilibrium instead of saturating.

Every function takes a session and is the ONLY thing that mutates that session;
the caller owns the session lifetime (create per request/call, close in finally).
The functions raise clean exceptions the HTTP layer maps to status codes:
  - LookupError -> 404 (assignment not found)
  - ValueError  -> 409 (illegal transition, e.g. already resolved)
"""

from datetime import datetime, timezone

from db import Assignment, Engineer


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_naive_utc(dt):
    """Normalize a datetime to naive-UTC so we can subtract regardless of whether
    the backend (SQLite) returned a naive value or an aware one. Without this,
    `aware - naive` raises TypeError."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _iso(dt):
    return dt.isoformat() if dt is not None else None


def _summary(a: Assignment) -> dict:
    """Serializable summary of an assignment (datetimes as ISO strings)."""
    return {
        "id": a.id,
        "alarm_id": a.alarm_id,
        "machine": a.machine,
        "zone": a.zone,
        "fault_category": a.fault_category,
        "engineer_id": a.engineer_id,
        "engineer_name": a.engineer_name,
        "status": a.status,
        "score": a.score,
        "assigned_at": _iso(a.assigned_at),
        "started_at": _iso(a.started_at),
        "resolved_at": _iso(a.resolved_at),
        "resolution_minutes": a.resolution_minutes,
    }


def _get_or_raise(assignment_id, session) -> Assignment:
    a = session.get(Assignment, assignment_id)
    if a is None:
        raise LookupError(f"assignment {assignment_id} not found")
    return a


def start_task(assignment_id, session) -> dict:
    """assigned -> in_progress. Idempotent if already in_progress; rejects a
    resolved task. Returns the updated summary."""
    a = _get_or_raise(assignment_id, session)
    if a.status == "resolved":
        raise ValueError(f"assignment {assignment_id} is already resolved")

    a.status = "in_progress"
    if a.started_at is None:
        a.started_at = _utcnow()

    session.commit()
    session.refresh(a)
    return _summary(a)


def resolve_task(assignment_id, session) -> dict:
    """-> resolved. Stamps resolved_at, computes resolution_minutes (from
    assigned_at), and DECREMENTS the assigned engineer's active_tasks (floored at
    0) to free capacity. Rejects an already-resolved task.

    Returns the summary plus:
      - engineer_active_tasks : the engineer's NEW active_tasks (freed capacity)
    """
    a = _get_or_raise(assignment_id, session)
    if a.status == "resolved":
        raise ValueError(f"assignment {assignment_id} is already resolved")

    now = _utcnow()
    a.status = "resolved"
    a.resolved_at = now

    # resolution_minutes = (resolved_at - assigned_at) in minutes, tz-safe.
    assigned = _to_naive_utc(a.assigned_at)
    resolved = _to_naive_utc(now)
    if assigned is not None:
        a.resolution_minutes = round(max(0.0, (resolved - assigned).total_seconds() / 60.0), 2)
    else:
        a.resolution_minutes = None

    # DECREMENT the engineer's active_tasks -> frees capacity (floor at 0).
    new_active = None
    engineer_name = a.engineer_name
    if a.engineer_id is not None:
        engineer = session.get(Engineer, a.engineer_id)
        if engineer is not None:
            engineer.active_tasks = max(0, (engineer.active_tasks or 0) - 1)
            new_active = engineer.active_tasks
            engineer_name = engineer.name or engineer_name

    session.commit()
    session.refresh(a)

    summary = _summary(a)
    summary["engineer_name"] = engineer_name
    summary["engineer_active_tasks"] = new_active
    return summary


def get_active_assignments(session, include_resolved: bool = False,
                           current_user=None) -> list:
    """Current non-resolved assignments (the technician's open queue), newest
    first. Pass include_resolved=True to include resolved ones too.

    Stage 3b: pass `current_user` to apply server-side role+zone SCOPING (the
    rule lives in scoping.scope_assignment_query). When current_user is None the
    query is UNSCOPED (backward-compatible for any non-HTTP caller/test)."""
    query = session.query(Assignment)
    if not include_resolved:
        query = query.filter(Assignment.status != "resolved")
    if current_user is not None:
        from scoping import scope_assignment_query
        query = scope_assignment_query(query, current_user)
    query = query.order_by(Assignment.assigned_at.desc())
    return [_summary(a) for a in query.all()]
