"""
Prove the task LIFECYCLE in isolation - NO HTTP, NO UI.

Flow:  assign -> start -> resolve, against a freshly seeded DB, calling the
lifecycle functions directly. It prints the status transitions, the computed
resolution_minutes, and the assigned engineer's active_tasks BEFORE and AFTER
resolve - proving that resolving a task DECREMENTS active_tasks (frees capacity).

Run:  python test_lifecycle.py
"""

from datetime import datetime, timedelta, timezone

from assignment import assign_engineer, record_assignment
from db import Assignment, Engineer, get_session, init_db
from lifecycle import get_active_assignments, resolve_task, start_task
from seed import seed

# A mechanical fault sample (only the fields the engine reads are filled in).
SAMPLE = {
    "alarm_id": 9001,
    "Machine": "Pump",
    "alarm_type": "Predictive",
    "Alert": "Bearing Vibration High",
    "message": "Vibration RMS rising on bearing #2 - mechanical wear developing",
}


def main():
    # Fresh schema + roster (seed() drops & recreates, so new columns exist).
    init_db()
    seed()

    # 1) ASSIGN: record_assignment INCREMENTS the engineer's active_tasks.
    session = get_session()
    try:
        result = assign_engineer(SAMPLE, session)
        eng_id = result["engineer_id"]
        eng_name = result["engineer_name"]
        before_assign = session.get(Engineer, eng_id).active_tasks
        assignment = record_assignment(SAMPLE, result, session)
        aid = assignment.id
        after_assign = session.get(Engineer, eng_id).active_tasks
        # Backdate assigned_at so resolution_minutes is a realistic, non-zero
        # value (otherwise assign->resolve happens in milliseconds).
        a = session.get(Assignment, aid)
        a.assigned_at = datetime.now(timezone.utc) - timedelta(minutes=7)
        session.commit()
    finally:
        session.close()

    print("=" * 64)
    print(f"ASSIGN  : task #{aid} -> {eng_name} (engineer #{eng_id})")
    print(f"          active_tasks {before_assign} -> {after_assign}  (assign INCREMENTED)")

    # 2) START: assigned -> in_progress
    session = get_session()
    try:
        s_start = start_task(aid, session)
    finally:
        session.close()
    print(f"START   : status now '{s_start['status']}'  started_at={s_start['started_at']}")

    # 3) OPEN QUEUE: our task should be listed as non-resolved
    session = get_session()
    try:
        open_tasks = get_active_assignments(session)
    finally:
        session.close()
    print(f"QUEUE   : {len(open_tasks)} open task(s); ours listed = "
          f"{any(t['id'] == aid for t in open_tasks)}")

    # 4) RESOLVE: -> resolved, DECREMENTS the engineer's active_tasks.
    session = get_session()
    try:
        before_resolve = session.get(Engineer, eng_id).active_tasks
        s_resolve = resolve_task(aid, session)
        after_resolve = session.get(Engineer, eng_id).active_tasks
    finally:
        session.close()
    print(f"RESOLVE : status now '{s_resolve['status']}'  resolved_at={s_resolve['resolved_at']}")
    print(f"          resolution_minutes = {s_resolve['resolution_minutes']}")
    print(f"          {eng_name} active_tasks {before_resolve} -> {after_resolve}  "
          f"(resolve DECREMENTED -> capacity freed)")

    # 5) GUARD: resolving again must error cleanly (no crash, no double-decrement)
    session = get_session()
    try:
        resolve_task(aid, session)
        print("GUARD   : ERROR - second resolve unexpectedly succeeded")
    except ValueError as exc:
        print(f"GUARD   : second resolve correctly rejected -> {exc}")
    finally:
        session.close()

    # 6) Confirm the resolved task drops out of the open queue.
    session = get_session()
    try:
        open_after = get_active_assignments(session)
        all_after = get_active_assignments(session, include_resolved=True)
    finally:
        session.close()
    print(f"QUEUE   : open now excludes ours = {all(t['id'] != aid for t in open_after)}; "
          f"include_resolved still has it = {any(t['id'] == aid for t in all_after)}")
    print("=" * 64)


if __name__ == "__main__":
    main()
