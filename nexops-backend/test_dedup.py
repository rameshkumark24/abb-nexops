"""
Prove TASK DE-DUPLICATION in the assignment path.

A developing fault re-emits a Warning every fleet sweep (~26s) but is ONE
physical fault, so it must create exactly ONE open task per (machine,
fault_category) until resolved. These tests mirror main.on_message's decision
(should_assign gate + DB open-task lookup) against a real (SQLite) DB, exercising
the new find_open_assignment de-dup primitive end-to-end. No broker, no MQTT.

Run:  python test_dedup.py      (or: pytest test_dedup.py)
"""

from assignment import (
    assign_engineer,
    record_assignment,
    fault_category_for,
    find_open_assignment,
    OPEN_STATUSES,
)
from lifecycle import resolve_task
from db import Assignment, get_session, reset_db
from seed import seed
from main import should_assign

# Developing MECHANICAL fault (incubating predictive Warning), same machine.
MECH_WARN = {
    "alarm_id": 7001, "Machine": "Motor B1", "zone": "B",
    "Status": "Warning", "alarm_priority": "Medium", "alarm_type": "Predictive",
    "is_predictive": True, "is_nuisance": False,
    "Alert": "Bearing Wear Trend",
    "message": "Bearing Degradation developing - Bearing Temp trending up = 78.0 C "
               "(static limit 80.0 C not yet reached)",
}
# DIFFERENT category (electrical) on the SAME machine.
ELEC_WARN = {
    "alarm_id": 7010, "Machine": "Motor B1", "zone": "B",
    "Status": "Warning", "alarm_priority": "High", "alarm_type": "Electrical",
    "is_predictive": False, "is_nuisance": False,
    "Alert": "Motor Overcurrent",
    "message": "Overcurrent on motor winding - electrical overload detected",
}
# NUISANCE on the same machine (Status=Warning but is_nuisance=True).
NUISANCE = {
    "alarm_id": 7020, "Machine": "Motor B1", "zone": "B",
    "Status": "Warning", "alarm_priority": "Low", "alarm_type": "Process",
    "is_predictive": False, "is_nuisance": True, "nuisance_type": "chatter",
    "Alert": "Threshold Chatter",
    "message": "Vibration momentarily crossed limit then settled "
               "(nuisance/chatter - no developing trend)",
}


def _fresh_db():
    """Clean fixture: drop+recreate tables and reseed the roster."""
    reset_db()
    seed()


def _ingest(record, session):
    """Mirror main.on_message exactly: gate on should_assign (nuisance excluded),
    then DB-backed create-or-reuse. Returns (status, assignment|None) where status
    is 'skipped' | 'created' | 'reused'."""
    if not should_assign(record):
        return "skipped", None
    machine = record["Machine"]
    category = fault_category_for(record)
    existing = find_open_assignment(session, machine, category)
    if existing is not None:
        return "reused", existing
    result = assign_engineer(record, session)
    a = record_assignment(record, result, session)
    return "created", a


def _count(session, machine, category):
    return session.query(Assignment).filter_by(machine=machine, fault_category=category).count()


def _open_count(session, machine, category):
    return (
        session.query(Assignment)
        .filter_by(machine=machine, fault_category=category)
        .filter(Assignment.status.in_(OPEN_STATUSES))
        .count()
    )


def test_consecutive_same_fault_creates_one_task():
    # (a) two consecutive Warning frames, same (machine, category) -> ONE task.
    _fresh_db()
    s = get_session()
    try:
        st1, a1 = _ingest(MECH_WARN, s)
        st2, a2 = _ingest(MECH_WARN, s)
        assert st1 == "created", st1
        assert st2 == "reused", st2
        assert a2.id == a1.id
        assert _count(s, "Motor B1", "mechanical") == 1
    finally:
        s.close()


def test_different_category_same_machine_creates_separate_task():
    # (b) a DIFFERENT fault_category on the same machine -> a SEPARATE task.
    _fresh_db()
    s = get_session()
    try:
        _ingest(MECH_WARN, s)
        st, _ = _ingest(ELEC_WARN, s)
        assert st == "created", st
        assert _count(s, "Motor B1", "mechanical") == 1
        assert _count(s, "Motor B1", "electrical") == 1
    finally:
        s.close()


def test_resolved_fault_allows_new_task():
    # (c) after the first task is RESOLVED, a later same-category fault -> NEW task.
    _fresh_db()
    s = get_session()
    try:
        st1, a1 = _ingest(MECH_WARN, s)
        assert st1 == "created", st1
        resolve_task(a1.id, s)  # status -> "resolved" (frees the (machine,category) slot)
        st2, a2 = _ingest(MECH_WARN, s)
        assert st2 == "created", st2
        assert a2.id != a1.id
        assert _count(s, "Motor B1", "mechanical") == 2     # one resolved + one open
        assert _open_count(s, "Motor B1", "mechanical") == 1
    finally:
        s.close()


def test_nuisance_never_creates_task():
    # (d) the nuisance guard still holds: a nuisance frame creates NO task.
    _fresh_db()
    s = get_session()
    try:
        st, a = _ingest(NUISANCE, s)
        assert st == "skipped" and a is None
        assert s.query(Assignment).count() == 0
    finally:
        s.close()


if __name__ == "__main__":
    checks = [
        ("(a) consecutive same fault -> ONE task", test_consecutive_same_fault_creates_one_task),
        ("(b) different category    -> SEPARATE task", test_different_category_same_machine_creates_separate_task),
        ("(c) resolved -> new task allowed", test_resolved_fault_allows_new_task),
        ("(d) nuisance -> NO task", test_nuisance_never_creates_task),
    ]
    ok = True
    for label, fn in checks:
        try:
            fn()
            print(f"  [PASS] {label}")
        except AssertionError as e:
            ok = False
            print(f"  [FAIL] {label}  -> {e}")
    print("\nALL PASS" if ok else "\nSOME FAILED")
