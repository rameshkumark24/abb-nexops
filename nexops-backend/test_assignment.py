"""
Prove the weighted assignment engine in ISOLATION.

What it does:
  1. inits + (re)seeds the DB (clean fixture every run),
  2. prints the engineer roster (so you can see who is loaded / unavailable),
  3. feeds several SAMPLE telemetry records of different fault types through
     assign_engineer(), printing for each: the fault category, EVERY available
     engineer's score breakdown, and the chosen engineer + reasoning.

Scoring here is PURE - no assignments are written, so the printed scores are
stable and comparable across records. (record_assignment is exercised at the end
as a small demo of the persistence side.)

Run:  python test_assignment.py
"""

from assignment import assign_engineer, record_assignment
from db import Engineer, get_session, init_db
from seed import seed

# Sample telemetry records, one per fault category. Shapes match the live
# TelemetryRecord (only the fields the engine reads are filled in here).
SAMPLES = [
    {
        "alarm_id": 5001,
        "Machine": "Pump",
        "alarm_type": "Predictive",
        "Alert": "Bearing Vibration High",
        "message": "Vibration RMS rising on bearing #2 - mechanical wear developing",
    },
    {
        "alarm_id": 5002,
        "Machine": "Motor",
        "alarm_type": "Electrical",
        "Alert": "Motor Overcurrent",
        "message": "Overcurrent on motor winding - electrical overload detected",
    },
    {
        "alarm_id": 5003,
        "Machine": "Heat Exchanger",
        "alarm_type": "Process",
        "Alert": "High Temperature",
        "message": "Overheating - coolant flow reduced, thermal limit approaching",
    },
    {
        "alarm_id": 5004,
        "Machine": "Generator",
        "alarm_type": "System",
        "Alert": "Status Check",
        "message": "General system notice - no specific fault signature",
    },
]


def print_roster(session):
    print("=" * 72)
    print("ENGINEER ROSTER")
    print("=" * 72)
    for e in session.query(Engineer).order_by(Engineer.id).all():
        flag = "AVAILABLE" if e.available else "UNAVAILABLE (skipped)"
        print(
            f"  #{e.id} {e.name:<14} | {flag:<22} | load={e.active_tasks:<2} "
            f"| skills={e.skills}"
        )
    print()


def print_result(record):
    session = get_session()
    try:
        result = assign_engineer(record, session)
    finally:
        session.close()

    category = result["fault_category"]
    print("-" * 72)
    print(f"RECORD alarm_id={record['alarm_id']} machine={record['Machine']!r}")
    print(f"  Alert  : {record['Alert']}")
    print(f"  Message: {record['message']}")
    print(f"  => fault_category = {category!r}")
    print(f"  candidate scores (available engineers only, best first):")
    for c in result["candidates"]:
        marker = "  <== CHOSEN" if c["engineer_id"] == result["engineer_id"] else ""
        print(
            f"    {c['engineer_name']:<14} score={c['score']:.3f}  "
            f"[skill={c['skill_match']:.2f} load={c['load_factor']:.2f} "
            f"speed={c['speed_factor']:.2f}]  "
            f"tasks={c['active_tasks']} mttr={c['mttr_minutes']:.0f}m{marker}"
        )
    if result["engineer_id"] is None:
        print(f"  RESULT : UNASSIGNED - {result['reasoning']}")
    else:
        print(f"  CHOSEN : {result['reasoning']}")
    print()


def main():
    init_db()
    seed()
    print()

    session = get_session()
    try:
        print_roster(session)
    finally:
        session.close()

    for record in SAMPLES:
        print_result(record)

    # --- small persistence demo (this DOES write) ---
    print("=" * 72)
    print("PERSISTENCE DEMO: record_assignment() for the bearing fault")
    print("=" * 72)
    session = get_session()
    try:
        rec = SAMPLES[0]
        result = assign_engineer(rec, session)
        before = session.get(Engineer, result["engineer_id"]).active_tasks
        assignment = record_assignment(rec, result, session)
        after = session.get(Engineer, result["engineer_id"]).active_tasks
        print(
            f"  saved assignment #{assignment.id}: {result['engineer_name']} "
            f"<- {result['fault_category']} fault on {rec['Machine']} "
            f"(status={assignment.status}, score={assignment.score:.3f})"
        )
        print(f"  {result['engineer_name']} active_tasks: {before} -> {after}")
    finally:
        session.close()


if __name__ == "__main__":
    main()
