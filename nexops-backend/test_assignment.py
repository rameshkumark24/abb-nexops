"""
Prove the weighted, ZONE-AWARE assignment engine in ISOLATION.

What it does:
  1. inits + (re)seeds the DB (clean fixture every run): 16 engineers across 4
     zones (A/B/C/D), 4 per zone,
  2. prints the engineer roster grouped by zone (who is loaded / at capacity /
     unavailable / which zone),
  3. feeds SAMPLE telemetry records - each carrying its machine's "zone" -
     through assign_engineer(), printing for each: the machine zone, the fault
     category, anyone EXCLUDED by the hard capacity cap, the top eligible
     engineers' score breakdown (skill/load/speed/exp/ZONE), the chosen engineer
     + reasoning, and a ZONE VERDICT (machine zone vs chosen engineer zone),
  4. demonstrates the NEW zone behaviour + that the old behaviour is intact:
       (a) ZONE PREFERENCE: a mechanical fault in Zone A goes to Ravi (Zone A),
           edging out the EQUALLY-skilled Boris (Zone B) purely on the same-zone
           bonus (skill/load/speed/exp are identical - only zone differs),
       (b) CROSS-ZONE FALLBACK: a hydraulic fault in Zone C has NO local hydraulic
           engineer, so it falls back to Mara (Zone D), the only hydraulic hand,
       (c) EXISTING behaviour intact - skill (electrical -> Priya), load/MTTR,
           thermal (-> Sam), general (-> Lena), EXPERIENCE on a CRITICAL
           electrical fault (-> senior Hassan over faster-but-junior Priya, both
           Zone B so the zone bonus cancels and experience decides), the hard
           CAPACITY cap, and the CRITICAL/safety BYPASS (which may cross zones).

Scoring is PURE - no assignments are written during the sample loop, so the
printed scores are stable and comparable. (record_assignment + the cap-exhaustion
cases mutate the DB and run last; the DB is reseeded on the next run.)

Run:  python test_assignment.py
"""

from assignment import assign_engineer, record_assignment
from db import Engineer, get_session, init_db
from seed import seed

# Sample telemetry records, one per scenario. Shapes match the live
# TelemetryRecord (only the fields the engine reads are filled in). Each carries
# a "zone" (the machine's zone) and a "_note" describing what it proves.
SAMPLES = [
    {
        # (a) ZONE PREFERENCE: mechanical fault in Zone A -> Ravi (A) beats the
        # identically-skilled Boris (B) on the same-zone bonus alone.
        "_note": "(a) ZONE PREFERENCE - same-zone engineer wins an otherwise-tied race",
        "alarm_id": 5001,
        "Machine": "Pump A1",
        "zone": "A",
        "alarm_type": "Predictive",
        "Alert": "Bearing Vibration High",
        "message": "Vibration RMS rising on bearing #2 - mechanical wear developing",
    },
    {
        # (c) skill + speed: NON-critical electrical in Zone B -> fast junior Priya
        # (Diego is faster still but UNAVAILABLE).
        "_note": "(c) electrical skill + speed - fast junior Priya wins (Diego off shift)",
        "alarm_id": 5002,
        "Machine": "Motor B1",
        "zone": "B",
        "alarm_type": "Electrical",
        "Alert": "Motor Overcurrent",
        "message": "Overcurrent on motor winding - electrical overload detected",
    },
    {
        # (c) thermal: Zone A thermal fault -> Sam (thermal, part-time).
        "_note": "(c) thermal skill - Sam wins (Zone A thermal specialist)",
        "alarm_id": 5003,
        "Machine": "Heat Exchanger A1",
        "zone": "A",
        "alarm_type": "Process",
        "Alert": "High Temperature",
        "message": "Overheating - coolant flow reduced, thermal limit approaching",
    },
    {
        # (c) general: no specific fault signature -> generalist Lena (Zone A).
        "_note": "(c) general fallback - generalist Lena wins (no specific signature)",
        "alarm_id": 5004,
        "Machine": "MCC Panel A1",
        "zone": "A",
        "alarm_type": "System",
        "Alert": "Status Check",
        "message": "General system notice - no specific fault signature",
    },
    {
        # (c) CRITICAL electrical in Zone B -> experience is weighted heavier,
        # tipping the choice to senior Hassan (18y) over fast junior Priya. Both
        # are Zone B, so the zone bonus cancels and EXPERIENCE decides.
        "_note": "(c) CRITICAL electrical - experience tips it to senior Hassan over Priya",
        "alarm_id": 5005,
        "Machine": "Generator B1",
        "zone": "B",
        "alarm_type": "Electrical",
        "alarm_priority": "Critical",
        "nexops_risk": "CRITICAL",
        "Alert": "Critical Overvoltage Trip",
        "message": "Critical overvoltage on feeder - electrical breaker tripped, immediate risk",
    },
    {
        # (b) CROSS-ZONE FALLBACK: hydraulic fault in Zone C, but the ONLY
        # hydraulic specialist (Mara) is in Zone D -> the fault falls back across
        # zones to her (skill 0.425 >> zone 0.08, so no local can win it).
        "_note": "(b) CROSS-ZONE FALLBACK - no hydraulic hand in Zone C -> Mara (Zone D)",
        "alarm_id": 5006,
        "Machine": "Control Valve C1",
        "zone": "C",
        "alarm_type": "Process",
        "Alert": "Hydraulic Actuator Fault",
        "message": "Hydraulic actuator fault - hydraulic pressure low, actuator not extending",
    },
]


def print_roster(session):
    print("=" * 78)
    print("ENGINEER ROSTER  (16 engineers, 4 per zone A/B/C/D)")
    print("=" * 78)
    engineers = session.query(Engineer).order_by(Engineer.zone, Engineer.id).all()
    current_zone = None
    for e in engineers:
        if e.zone != current_zone:
            current_zone = e.zone
            print(f"  --- Zone {current_zone} ---")
        if not e.available:
            flag = "UNAVAILABLE (skipped)"
        elif e.active_tasks >= e.max_capacity:
            flag = "AT CAPACITY (excluded)"
        else:
            flag = "available"
        print(
            f"    #{e.id:<2} {e.name:<14} | {flag:<22} | load={e.active_tasks}/{e.max_capacity} "
            f"| exp={e.experience_years:>2}y | skills={e.skills}"
        )
    print()


def _chosen_zone(result):
    """Zone of the chosen engineer (from its candidate row), or None."""
    for c in result.get("candidates", []):
        if c["engineer_id"] == result.get("engineer_id"):
            return c.get("zone")
    return None


def print_result(record, top_n=6):
    session = get_session()
    try:
        result = assign_engineer(record, session)
    finally:
        session.close()

    category = result["fault_category"]
    crit = "  [CRITICAL]" if result.get("critical") else ""
    machine_zone = result.get("machine_zone")
    print("-" * 78)
    if record.get("_note"):
        print(f"PROVES: {record['_note']}")
    print(f"RECORD alarm_id={record['alarm_id']} machine={record['Machine']!r} "
          f"zone={machine_zone!r}{crit}")
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

    shown = result["candidates"][:top_n]
    total = len(result["candidates"])
    print(f"  candidate scores (top {len(shown)} of {total} eligible, best first):")
    for c in shown:
        marker = "  <== CHOSEN" if c["engineer_id"] == result["engineer_id"] else ""
        zmark = "*" if c.get("same_zone") else " "
        print(
            f"    {c['engineer_name']:<14} score={c['score']:.3f}  "
            f"[skill={c['skill_match']:.2f} load={c['load_factor']:.2f} "
            f"speed={c['speed_factor']:.2f} exp={c['exp_factor']:.2f} "
            f"zone={c['zone']}{zmark}(+{c['zone_factor']:.0f})]  "
            f"tasks={c['active_tasks']}/{c['max_capacity']} "
            f"exp={c['experience_years']}y mttr={c['mttr_minutes']:.0f}m{marker}"
        )

    chosen_zone = _chosen_zone(result)
    if machine_zone:
        verdict = "SAME-ZONE" if chosen_zone == machine_zone else "CROSS-ZONE FALLBACK"
        print(f"  ZONE   : machine zone={machine_zone}  ->  chosen engineer zone={chosen_zone}"
              f"   [{verdict}]")
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
    print("=" * 78)
    print("PERSISTENCE DEMO: record_assignment() for the Zone-A bearing fault")
    print("=" * 78)
    session = get_session()
    try:
        rec = SAMPLES[0]
        result = assign_engineer(rec, session)
        before = session.get(Engineer, result["engineer_id"]).active_tasks
        assignment = record_assignment(rec, result, session)
        after = session.get(Engineer, result["engineer_id"]).active_tasks
        print(
            f"  saved assignment #{assignment.id}: {result['engineer_name']} "
            f"<- {result['fault_category']} fault on {rec['Machine']} (zone {rec['zone']}) "
            f"(status={assignment.status}, score={assignment.score:.3f})"
        )
        print(f"  {result['engineer_name']} active_tasks: {before} -> {after}")
    finally:
        session.close()
    print()

    # --- capacity-exhaustion + CRITICAL-BYPASS (incl. cross-zone) demo --------
    # Push EVERY engineer to their cap, then prove three behaviours:
    #   (c) a NON-critical fault stays UNASSIGNED (the hard cap is enforced),
    #   (c) a CRITICAL/safety FIRE is STILL ASSIGNED (the cap is bypassed),
    #       flagged safety_critical + cap_overridden,
    #   (b/D3) a CRITICAL HYDRAULIC fault in Zone A reaches Mara in Zone D - the
    #       cap is bypassed AND the dispatch crosses zones (critical may cross
    #       zones to find the best available engineer).
    # (Runs LAST because it mutates loads; the DB is reseeded on the next run.)
    print("=" * 78)
    print("CAPACITY-EXHAUSTION + CRITICAL-BYPASS DEMO: every engineer at max_capacity")
    print("=" * 78)
    session = get_session()
    try:
        for e in session.query(Engineer).all():
            e.active_tasks = e.max_capacity
        session.commit()
    finally:
        session.close()

    non_critical = {
        "alarm_id": 5007, "Machine": "Pump A1", "zone": "A", "alarm_type": "Predictive",
        "Alert": "Bearing Vibration High",
        "message": "Vibration RMS rising on bearing #2 - mechanical wear developing",
    }
    critical_fire = {
        "alarm_id": 5008, "Machine": "Storage Tank C1", "zone": "C", "alarm_type": "Safety",
        "alarm_priority": "Critical", "nexops_risk": "CRITICAL",
        "Alert": "FIRE DETECTED",
        "message": "FIRE DETECTED on Storage Tank - site emergency",
    }
    critical_hydraulic_zone_a = {
        "alarm_id": 5009, "Machine": "Control Valve A-emergency", "zone": "A",
        "alarm_type": "Process", "alarm_priority": "Critical", "nexops_risk": "CRITICAL",
        "Alert": "Hydraulic Actuator Failure",
        "message": "Hydraulic actuator failure - hydraulic lock, immediate risk",
    }

    session = get_session()
    try:
        r_non = assign_engineer(non_critical, session)
        r_fire = assign_engineer(critical_fire, session)
        r_hyd = assign_engineer(critical_hydraulic_zone_a, session)
    finally:
        session.close()

    print("  (c) NON-critical fault while everyone is at cap (cap ENFORCED):")
    print(f"      assigned={r_non.get('assigned')}  -> {r_non['reasoning']}")
    print("  (c) CRITICAL FIRE while everyone is at cap (cap BYPASSED):")
    print(f"      assigned={r_fire.get('assigned')}  "
          f"safety_critical={r_fire.get('safety_critical')}  "
          f"cap_overridden={r_fire.get('cap_overridden')}")
    print(f"      machine zone={r_fire.get('machine_zone')} -> engineer zone={_chosen_zone(r_fire)}")
    print(f"      -> {r_fire.get('engineer_name')}: {r_fire['reasoning']}")
    print("  (b/D3) CRITICAL HYDRAULIC fault in Zone A while everyone is at cap "
          "(cap BYPASSED + CROSS-ZONE):")
    print(f"      assigned={r_hyd.get('assigned')}  "
          f"safety_critical={r_hyd.get('safety_critical')}  "
          f"cap_overridden={r_hyd.get('cap_overridden')}")
    print(f"      machine zone={r_hyd.get('machine_zone')} -> engineer zone={_chosen_zone(r_hyd)}"
          f"   [{'SAME-ZONE' if _chosen_zone(r_hyd) == r_hyd.get('machine_zone') else 'CROSS-ZONE'}]")
    print(f"      -> {r_hyd.get('engineer_name')}: {r_hyd['reasoning']}")
    print()


if __name__ == "__main__":
    main()
