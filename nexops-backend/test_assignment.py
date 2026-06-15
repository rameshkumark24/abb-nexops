"""
Prove the weighted assignment engine in ISOLATION.

What it does:
  1. inits + (re)seeds the DB (clean fixture every run),
  2. prints the engineer roster (who is loaded / at capacity / unavailable),
  3. feeds SAMPLE telemetry records of different fault types through
     assign_engineer(), printing for each: the fault category, anyone EXCLUDED
     by the hard capacity cap, every eligible engineer's full score breakdown
     (skill/load/speed/exp), and the chosen engineer + reasoning,
  4. demonstrates the two NEW behaviours explicitly:
       - a hydraulic fault whose ONLY skilled engineer (Mara) is AT CAPACITY ->
         she is excluded and the fault routes to the next-best generalist,
       - a CRITICAL electrical fault where EXPERIENCE tips the choice to the
         senior (Hassan, 18y) over the faster-but-junior Priya,
       - a capacity-exhaustion case where EVERY engineer is at cap -> a
         NON-critical fault stays "all at capacity" UNASSIGNED, while a
         CRITICAL/safety fault BYPASSES the cap and is STILL assigned.

Scoring is PURE - no assignments are written during the sample loop, so the
printed scores are stable and comparable. (record_assignment + the cap-exhaustion
case mutate the DB and run last; the DB is reseeded on the next run.)

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
    {
        # CRITICAL electrical fault -> experience is weighted heavier, tipping the
        # choice to the senior (Hassan, 18y) over the faster-but-junior Priya.
        "alarm_id": 5005,
        "Machine": "Switchgear",
        "alarm_type": "Electrical",
        "alarm_priority": "Critical",
        "nexops_risk": "CRITICAL",
        "Alert": "Critical Overvoltage Trip",
        "message": "Critical overvoltage on feeder - electrical breaker tripped, immediate risk",
    },
    {
        # Hydraulic fault -> the ONLY hydraulic-skilled engineer (Mara) is at
        # capacity, so she is excluded and the fault routes to the next-best.
        "alarm_id": 5006,
        "Machine": "Press",
        "alarm_type": "Process",
        "Alert": "Hydraulic Actuator Fault",
        "message": "Hydraulic actuator fault - hydraulic pressure low, actuator not extending",
    },
]


def print_roster(session):
    print("=" * 72)
    print("ENGINEER ROSTER")
    print("=" * 72)
    for e in session.query(Engineer).order_by(Engineer.id).all():
        if not e.available:
            flag = "UNAVAILABLE (skipped)"
        elif e.active_tasks >= e.max_capacity:
            flag = "AT CAPACITY (excluded)"
        else:
            flag = "available"
        print(
            f"  #{e.id} {e.name:<13} | {flag:<22} | load={e.active_tasks}/{e.max_capacity} "
            f"| exp={e.experience_years:>2}y | skills={e.skills}"
        )
    print()


def print_result(record):
    session = get_session()
    try:
        result = assign_engineer(record, session)
    finally:
        session.close()

    category = result["fault_category"]
    crit = "  [CRITICAL]" if result.get("critical") else ""
    print("-" * 72)
    print(f"RECORD alarm_id={record['alarm_id']} machine={record['Machine']!r}{crit}")
    print(f"  Alert  : {record['Alert']}")
    print(f"  Message: {record['message']}")
    print(f"  => fault_category = {category!r}")

    excluded = result.get("excluded_at_capacity") or []
    if excluded:
        names = ", ".join(
            f"{x['engineer_name']} ({x['active_tasks']}/{x['max_capacity']})" for x in excluded
        )
        print(f"  EXCLUDED by capacity cap: {names}")

    if not result["candidates"]:
        print(f"  RESULT : UNASSIGNED - {result['reasoning']}")
        print()
        return

    print(f"  candidate scores (eligible engineers only, best first):")
    for c in result["candidates"]:
        marker = "  <== CHOSEN" if c["engineer_id"] == result["engineer_id"] else ""
        print(
            f"    {c['engineer_name']:<13} score={c['score']:.3f}  "
            f"[skill={c['skill_match']:.2f} load={c['load_factor']:.2f} "
            f"speed={c['speed_factor']:.2f} exp={c['exp_factor']:.2f}]  "
            f"tasks={c['active_tasks']}/{c['max_capacity']} "
            f"exp={c['experience_years']}y mttr={c['mttr_minutes']:.0f}m{marker}"
        )
    if result.get("assigned"):
        print(f"  CHOSEN : {result['reasoning']}")
    else:
        print(f"  RESULT : UNASSIGNED - {result['reasoning']}")
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
    print()

    # --- capacity-exhaustion + CRITICAL-BYPASS demo ----------------------
    # Push EVERY engineer to their cap, then prove the two behaviours:
    #   (b) a NON-critical fault stays UNASSIGNED (the hard cap is enforced),
    #   (a) a CRITICAL/safety fault is STILL ASSIGNED (the cap is bypassed),
    #       and is flagged safety_critical + cap_overridden.
    # (Runs LAST because it mutates loads; the DB is reseeded on the next run.)
    print("=" * 72)
    print("CAPACITY-EXHAUSTION + CRITICAL-BYPASS DEMO: every engineer at max_capacity")
    print("=" * 72)
    session = get_session()
    try:
        for e in session.query(Engineer).all():
            e.active_tasks = e.max_capacity
        session.commit()
    finally:
        session.close()

    non_critical = {
        "alarm_id": 5007, "Machine": "Pump", "alarm_type": "Predictive",
        "Alert": "Bearing Vibration High",
        "message": "Vibration RMS rising on bearing #2 - mechanical wear developing",
    }
    critical_safety = {
        "alarm_id": 5008, "Machine": "Storage Tank", "alarm_type": "Safety",
        "alarm_priority": "Critical", "nexops_risk": "CRITICAL",
        "Alert": "FIRE DETECTED",
        "message": "FIRE DETECTED on Storage Tank - site emergency",
    }

    session = get_session()
    try:
        r_non = assign_engineer(non_critical, session)
        r_crit = assign_engineer(critical_safety, session)
    finally:
        session.close()

    print("  (b) NON-critical fault while everyone is at cap (cap ENFORCED):")
    print(f"      assigned={r_non.get('assigned')}  -> {r_non['reasoning']}")
    print("  (a) CRITICAL/safety fault while everyone is at cap (cap BYPASSED):")
    print(f"      assigned={r_crit.get('assigned')}  "
          f"safety_critical={r_crit.get('safety_critical')}  "
          f"cap_overridden={r_crit.get('cap_overridden')}")
    print(f"      -> {r_crit.get('engineer_name')}: {r_crit['reasoning']}")
    print()


if __name__ == "__main__":
    main()
