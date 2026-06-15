"""
Weighted engineer-assignment ENGINE - pure logic, no bridge.

This module scores available engineers against a telemetry record and picks the
best match. Scoring is PURE (no DB writes); persistence is a separate explicit
step (record_assignment) so the scoring can be tested with zero side effects.

It is STANDALONE: not imported by main.py yet. The live bridge will wire it in
later at the existing TODO(Stage: assignment) marker.
"""

from db import Assignment, Engineer, FaultMTTR

# ----------------------------------------------------------------------
# Weights (skill DOMINANT). They sum to 1.0 so a final score is in 0..1.
# ----------------------------------------------------------------------
SKILL_WEIGHT = 0.60   # having the matching skill is the biggest driver
LOAD_WEIGHT = 0.20    # prefer engineers with spare capacity
MTTR_WEIGHT = 0.20    # prefer engineers historically fast at THIS category

# Tunables
SKILL_BASE = 0.15     # skill_match when the engineer LACKS the category skill
MAX_LOAD = 10         # active_tasks at/above which load_factor bottoms out at 0
NO_HISTORY_MTTR = 60.0  # fallback MTTR (minutes) when an engineer has no history


# ----------------------------------------------------------------------
# Fault-category mapping.
#
# We map a telemetry record to ONE fault category from its text fields. The
# strongest signal is alarm_type == "Electrical"; otherwise we keyword-match
# across alarm_type + Alert + message (lower-cased). Categories are checked in
# the order below; first hit wins. Anything unmatched -> "general".
# ----------------------------------------------------------------------
FAULT_KEYWORDS = {
    "mechanical": [
        "vibration", "bearing", "mechanical", "imbalance", "misalign",
        "rotor", "gearbox", "seal", "lubricat", "looseness", "cavitation",
    ],
    "electrical": [
        "overcurrent", "over-current", "overload", "electrical", "voltage",
        "current", "winding", "insulation", "phase", "breaker",
        "short circuit", "ground fault", "motor",
    ],
    "thermal": [
        "temp", "temperature", "overheat", "thermal", "cooling", "coolant",
        "heat", "fouling",
    ],
}


def fault_category_for(record: dict) -> str:
    """Map a telemetry record to a fault category. Defaults to "general"."""
    alarm_type = str(record.get("alarm_type", "") or "").lower()
    if alarm_type == "electrical":
        return "electrical"

    text = " ".join(
        str(record.get(k, "") or "") for k in ("alarm_type", "Alert", "message")
    ).lower()

    for category, keywords in FAULT_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return category
    return "general"


# ----------------------------------------------------------------------
# Scoring
# ----------------------------------------------------------------------

def _mttr_for(session, engineer_id: int, category: str) -> float:
    """Return this engineer's MTTR (minutes) for the category, or a high
    fallback when there is no history (so 'unknown' looks slow, not fast)."""
    row = (
        session.query(FaultMTTR)
        .filter(FaultMTTR.engineer_id == engineer_id)
        .filter(FaultMTTR.fault_category == category)
        .first()
    )
    return float(row.mttr_minutes) if row is not None else NO_HISTORY_MTTR


def _reasoning(best: dict, category: str) -> str:
    """Build a short human explanation of WHY this engineer won."""
    skill_part = (
        f"{category} skill match" if best["has_skill"] else f"no direct {category} skill"
    )
    load_part = f"low load ({best['active_tasks']} task{'s' if best['active_tasks'] != 1 else ''})"
    if best["active_tasks"] >= MAX_LOAD * 0.6:
        load_part = f"high load ({best['active_tasks']} tasks)"
    speed_part = f"{category} MTTR {best['mttr_minutes']:.0f}m"
    return (
        f"{best['engineer_name']}: {skill_part}, {load_part}, {speed_part} "
        f"(score {best['score']:.3f})"
    )


def assign_engineer(record: dict, session) -> dict:
    """Score every AVAILABLE engineer for this record and pick the best.

    Pure: reads the DB but writes nothing. Returns:
      {
        engineer_id, engineer_name, fault_category, score, reasoning,
        candidates: [ {engineer_id, engineer_name, score, skill_match,
                       load_factor, speed_factor, active_tasks, mttr_minutes,
                       has_skill}, ... ]  # sorted best-first
      }

    Weighted model (weights sum to 1.0):
        score = SKILL_WEIGHT * skill_match    # 1.0 if has category skill else SKILL_BASE
              + LOAD_WEIGHT  * load_factor     # (MAX_LOAD - active_tasks)/MAX_LOAD, clamped 0..1
              + MTTR_WEIGHT  * speed_factor     # min-max normalized over the candidate pool,
                                                #   1.0 = fastest in pool, 0.0 = slowest

    No-available-engineer case returns a clear "unassigned" result (never raises).
    """
    category = fault_category_for(record)

    engineers = (
        session.query(Engineer).filter(Engineer.available.is_(True)).all()
    )
    if not engineers:
        return {
            "engineer_id": None,
            "engineer_name": None,
            "fault_category": category,
            "score": 0.0,
            "reasoning": f"No available engineer for a {category} fault - left UNASSIGNED.",
            "candidates": [],
        }

    # Per-category MTTR for each candidate, used to normalize speed_factor
    # RELATIVE to the pool (fastest -> 1.0, slowest -> 0.0).
    mttrs = {e.id: _mttr_for(session, e.id, category) for e in engineers}
    min_m, max_m = min(mttrs.values()), max(mttrs.values())

    candidates = []
    for e in engineers:
        has_skill = category in (e.skills or [])
        skill_match = 1.0 if has_skill else SKILL_BASE

        # load_factor: 0 tasks -> 1.0 ; >= MAX_LOAD tasks -> 0.0
        load_factor = max(0.0, min(1.0, (MAX_LOAD - e.active_tasks) / MAX_LOAD))

        # speed_factor: min-max over the pool; if all equal, neutral 0.5
        m = mttrs[e.id]
        speed_factor = (max_m - m) / (max_m - min_m) if max_m > min_m else 0.5

        score = (
            SKILL_WEIGHT * skill_match
            + LOAD_WEIGHT * load_factor
            + MTTR_WEIGHT * speed_factor
        )

        candidates.append(
            {
                "engineer_id": e.id,
                "engineer_name": e.name,
                "has_skill": has_skill,
                "skill_match": round(skill_match, 3),
                "load_factor": round(load_factor, 3),
                "speed_factor": round(speed_factor, 3),
                "active_tasks": e.active_tasks,
                "mttr_minutes": m,
                "score": round(score, 4),
            }
        )

    # Highest score wins; tie-break deterministically by engineer_id.
    candidates.sort(key=lambda c: (-c["score"], c["engineer_id"]))
    best = candidates[0]

    return {
        "engineer_id": best["engineer_id"],
        "engineer_name": best["engineer_name"],
        "fault_category": category,
        "score": best["score"],
        "reasoning": _reasoning(best, category),
        "candidates": candidates,
    }


def record_assignment(record: dict, result: dict, session) -> Assignment:
    """Persist an assignment and increment the chosen engineer's active_tasks.

    Side-effecting on purpose - kept SEPARATE from assign_engineer so scoring can
    be tested without touching the DB. Safe to call with an 'unassigned' result
    (engineer_id None): it records the unassigned fault and increments nobody.
    """
    assignment = Assignment(
        alarm_id=record.get("alarm_id"),
        machine=record.get("Machine"),
        fault_category=result.get("fault_category", "general"),
        engineer_id=result.get("engineer_id"),
        status="assigned",
        score=result.get("score"),
    )
    session.add(assignment)

    engineer_id = result.get("engineer_id")
    if engineer_id is not None:
        engineer = session.get(Engineer, engineer_id)
        if engineer is not None:
            engineer.active_tasks = (engineer.active_tasks or 0) + 1

    session.commit()
    session.refresh(assignment)
    return assignment
