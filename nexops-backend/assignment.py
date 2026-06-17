"""
Weighted engineer-assignment ENGINE - pure logic, no bridge.

This module scores available engineers against a telemetry record and picks the
best match. Scoring is PURE (no DB writes); persistence is a separate explicit
step (record_assignment) so the scoring can be tested with zero side effects.

It is STANDALONE: not imported by main.py yet. The live bridge will wire it in
later at the existing TODO(Stage: assignment) marker.
"""

import re

from db import Assignment, Engineer, FaultMTTR

# ----------------------------------------------------------------------
# Weights (skill DOMINANT). The four BASE weights sum to 1.0 so a base score
# is in 0..1.
# ----------------------------------------------------------------------
SKILL_WEIGHT = 0.50   # having the matching skill is still the biggest driver
LOAD_WEIGHT = 0.18    # prefer engineers with spare capacity (a SOFT nudge)
MTTR_WEIGHT = 0.18    # prefer engineers historically fast at THIS category
EXP_WEIGHT = 0.14     # prefer more experienced engineers
# (0.50 + 0.18 + 0.18 + 0.14 = 1.00)

# ZONE PREFERENCE (Stage 1 of the zone hierarchy). A small ADDITIVE bonus given
# to an engineer whose zone == the machine's zone (read from record["zone"]).
# It is a TIEBREAKER, never an override: it is deliberately far smaller than the
# skill gap. Having vs lacking the category skill is worth
# SKILL_WEIGHT * (1.0 - SKILL_BASE) = 0.50 * 0.85 = 0.425, so a 0.08 same-zone
# bonus can NEVER make an unskilled local beat a skilled engineer in another
# zone. That is precisely what gives us cross-zone FALLBACK: when no skilled
# engineer exists in the machine's zone, a skilled OTHER-zone engineer still wins
# (skill 0.425 >> zone 0.08). Like CRIT_EXP_MULTIPLIER, this can push a winning
# score slightly above 1.0; only the RANKING matters, since every candidate for
# the same fault is scored with identical weights. When a record has NO "zone"
# (or an engineer has no zone), the term is 0 and behaviour is exactly as before.
ZONE_WEIGHT = 0.08

# CRITICAL faults weigh experience heavier: the experience term is multiplied by
# this factor (effective EXP weight = EXP_WEIGHT * CRIT_EXP_MULTIPLIER = 0.28 for
# Critical). This intentionally over-weights experience for critical faults; it
# is fine that the effective weights then exceed 1.0, because every candidate
# for the SAME fault is scored with identical weights, so only the RANKING (not
# the absolute 0..1 range) matters.
CRIT_EXP_MULTIPLIER = 2.0

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
    "hydraulic": [
        "hydraulic", "hydraulics", "actuator",
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


def _is_critical(record: dict) -> bool:
    """A fault is 'critical' when the gateway priority is Critical OR NexOps has
    elevated the risk to CRITICAL. Critical faults weigh experience heavier."""
    if str(record.get("alarm_priority", "") or "").lower() == "critical":
        return True
    if str(record.get("nexops_risk", "") or "").upper() == "CRITICAL":
        return True
    return False


# ----------------------------------------------------------------------
# Critical / SAFETY detection (drives the capacity-cap BYPASS).
# A site-wide emergency must ALWAYS be dispatched, so we detect it broadly.
# ----------------------------------------------------------------------

# alarm_type values that denote a genuine SAFETY category. Only "Safety" counts:
# "System" is a catch-all (it tags benign status notices AS WELL AS emergency
# stops), so it is NOT treated as safety here. Real emergency-stop events are
# still caught below - they carry Critical priority and the word "EMERGENCY".
SAFETY_ALARM_TYPES = ("safety",)
# Words/phrases that denote a site emergency, regardless of priority.
SAFETY_KEYWORDS = ("fire", "gas leak", "emergency", "explosion", "explosive", "toxic")
# Match each keyword as a WHOLE word/phrase, never a loose substring - so "fire"
# triggers on "FIRE DETECTED" but NOT inside "Fired Heater" / "misfire", and a
# "general system notice" never matches anything.
_SAFETY_KEYWORD_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(kw) for kw in SAFETY_KEYWORDS) + r")\b"
)


def is_safety_critical(record: dict) -> bool:
    """True for critical/SAFETY events that must ALWAYS be dispatched (they
    BYPASS the capacity cap). Keys on ANY of:
      - alarm_priority == "Critical"
      - nexops_risk    == "CRITICAL"
      - alarm_type == "Safety"  (genuine safety category; NOT "System")
      - Alert/message contains a whole-word FIRE / GAS LEAK / EMERGENCY (etc.)
    A plain "System" status notice with no Critical severity and no safety
    keyword (e.g. "General system notice") is therefore NON-critical.
    """
    if str(record.get("alarm_priority", "") or "").lower() == "critical":
        return True
    if str(record.get("nexops_risk", "") or "").upper() == "CRITICAL":
        return True
    if str(record.get("alarm_type", "") or "").lower() in SAFETY_ALARM_TYPES:
        return True
    text = " ".join(
        str(record.get(k, "") or "") for k in ("Alert", "message")
    ).lower()
    return bool(_SAFETY_KEYWORD_RE.search(text))


def _unassigned(category: str, reason: str) -> dict:
    """A clear, non-crashing 'nobody could take this' result."""
    return {
        "assigned": False,
        "engineer_id": None,
        "engineer_name": None,
        "fault_category": category,
        "score": 0.0,
        "critical": False,
        "safety_critical": False,
        "cap_overridden": False,
        "staffing_escalation": False,
        "machine_zone": None,
        "reasoning": reason,
        "candidates": [],
        "excluded_at_capacity": [],
    }


def _reasoning(best: dict, category: str, critical: bool,
               safety_critical: bool = False, cap_overridden: bool = False,
               machine_zone: str = None) -> str:
    """Build a short human explanation of WHY this engineer won."""
    skill_part = (
        f"{category} skill match" if best["has_skill"] else f"no direct {category} skill"
    )
    load_part = f"low load ({best['active_tasks']} task{'s' if best['active_tasks'] != 1 else ''})"
    if best["active_tasks"] >= MAX_LOAD * 0.6:
        load_part = f"high load ({best['active_tasks']} tasks)"
    speed_part = f"{category} MTTR {best['mttr_minutes']:.0f}m"
    exp_part = f"{best['experience_years']}y experience"
    zone_tag = f" [zone {best.get('zone') or '-'}]"
    text = f"{best['engineer_name']}{zone_tag}: {skill_part}, {load_part}, {speed_part}, {exp_part}"
    if critical and best["experience_years"] >= 10:
        text += f" - senior ({best['experience_years']}y) preferred for CRITICAL fault"
    elif critical:
        text += " - CRITICAL fault (experience weighted higher)"
    # Zone note: why the chosen engineer's zone relates to the machine's zone.
    if machine_zone:
        best_zone = best.get("zone") or "-"
        if best.get("same_zone"):
            text += f" | same-zone match (zone {machine_zone}) - local engineer preferred"
        elif safety_critical:
            text += (f" | CRITICAL event - best AVAILABLE dispatched across zones "
                     f"(machine zone {machine_zone} -> engineer zone {best_zone})")
        else:
            text += (f" | no suitable engineer in zone {machine_zone} - cross-zone "
                     f"FALLBACK to zone {best_zone}")
    if safety_critical:
        text += (" | CRITICAL safety event - capacity cap overridden"
                 if cap_overridden else " | CRITICAL safety event - immediate dispatch")
    return text + f" (score {best['score']:.3f})"


def assign_engineer(record: dict, session) -> dict:
    """Score every AVAILABLE engineer for this record and pick the best.

    Pure: reads the DB but writes nothing. Returns:
      {
        engineer_id, engineer_name, fault_category, score, reasoning,
        candidates: [ {engineer_id, engineer_name, score, skill_match,
                       load_factor, speed_factor, active_tasks, mttr_minutes,
                       has_skill}, ... ]  # sorted best-first
      }

    Weighted model (base weights sum to 1.0; zone is an additive bonus on top):
        score = SKILL_WEIGHT * skill_match    # 1.0 if has category skill else SKILL_BASE
              + LOAD_WEIGHT  * load_factor     # (MAX_LOAD - active_tasks)/MAX_LOAD, clamped 0..1
              + MTTR_WEIGHT  * speed_factor     # min-max normalized over the eligible pool,
                                                #   1.0 = fastest, 0.0 = slowest
              + exp_weight   * exp_factor       # min-max normalized experience over the pool;
                                                #   exp_weight is boosted for CRITICAL faults
              + ZONE_WEIGHT  * zone_factor      # +ZONE_WEIGHT iff engineer.zone == machine zone
                                                #   (record["zone"]); a small SAME-ZONE tiebreaker

    ZONE PREFERENCE: the machine's zone comes from record["zone"]. Same-zone
    engineers get a small ZONE_WEIGHT bonus so a LOCAL engineer is preferred -
    but only as a tiebreaker, never over skill (the bonus is far smaller than the
    skill gap). If NO skilled engineer exists in the machine's zone, a skilled
    OTHER-zone engineer still wins => cross-zone FALLBACK. A missing/empty zone on
    the record disables the term entirely (behaviour identical to before zones).
    NOTE: a CRITICAL/safety event is dispatched to the best AVAILABLE engineer and
    may therefore cross zones regardless of the local roster.

    HARD CAPACITY CAP: for NON-critical faults, engineers with active_tasks >=
    max_capacity are filtered OUT before scoring (cannot take another task at
    all), distinct from the SOFT load_factor which only nudges among those still
    under cap.

    CRITICAL / SAFETY BYPASS: when is_safety_critical(record) is true (fire /
    gas-leak / emergency-stop / Critical safety event), the hard cap is IGNORED -
    every AVAILABLE (on-shift) engineer is scored so the event is ALWAYS
    dispatched. Only a total absence of available engineers can leave a critical
    event unassigned, and that is flagged as a STAFFING ESCALATION (not a routine
    'at capacity').

    Returns extra flags: "assigned", "critical", "safety_critical",
    "cap_overridden", "staffing_escalation", and "excluded_at_capacity".
    """
    category = fault_category_for(record)
    critical = _is_critical(record)
    safety_critical = is_safety_critical(record)
    # The machine's zone (if the record carries one). Empty/missing -> no zone
    # preference, so the engine behaves exactly as it did before zones existed.
    machine_zone = str(record.get("zone", "") or "").strip() or None

    # Skip UNAVAILABLE / off-shift engineers for everyone.
    available = session.query(Engineer).filter(Engineer.available.is_(True)).all()
    if not available:
        # Nobody on shift at all. For a safety event this is a STAFFING
        # ESCALATION (a people problem), explicitly NOT a routine 'at capacity'.
        if safety_critical:
            res = _unassigned(
                category,
                "CRITICAL safety event but NO engineer is on shift - STAFFING "
                "ESCALATION required (could not dispatch).",
            )
            res["safety_critical"] = True
            res["staffing_escalation"] = True
            return res
        return _unassigned(
            category, f"No engineer is available for a {category} fault - left UNASSIGNED."
        )

    # Who is at/over the hard cap (used for the cap and for the override note).
    excluded_at_capacity = [
        {
            "engineer_id": e.id,
            "engineer_name": e.name,
            "active_tasks": e.active_tasks,
            "max_capacity": e.max_capacity,
        }
        for e in available
        if e.active_tasks >= e.max_capacity
    ]

    if safety_critical:
        # BYPASS the hard cap: a fire / gas-leak / emergency-stop / Critical
        # safety event must ALWAYS be dispatched. We still skip UNAVAILABLE
        # engineers, but we IGNORE the active_tasks>=max_capacity exclusion and
        # score EVERY available engineer, so the event is never left unassigned
        # while anyone is on shift.
        pool = available
    else:
        # NON-critical: enforce the HARD CAPACITY CAP (a FILTER, not a score
        # tweak) - an engineer at/over max_capacity is removed entirely, even if
        # they hold the only matching skill. If that leaves nobody, it's a
        # routine 'at capacity' (NOT a staffing escalation).
        pool = [e for e in available if e.active_tasks < e.max_capacity]
        if not pool:
            result = _unassigned(
                category, "All qualified engineers are at capacity - left UNASSIGNED."
            )
            result["excluded_at_capacity"] = excluded_at_capacity
            return result

    # The cap was meaningfully overridden when a safety event had to reach past
    # at-capacity engineers to dispatch someone.
    cap_overridden = safety_critical and bool(excluded_at_capacity)

    # Normalize speed_factor and exp_factor RELATIVE to the scoring pool.
    mttrs = {e.id: _mttr_for(session, e.id, category) for e in pool}
    min_m, max_m = min(mttrs.values()), max(mttrs.values())

    exps = {e.id: (e.experience_years or 0) for e in pool}
    min_e, max_e = min(exps.values()), max(exps.values())

    # Experience is weighted heavier for critical faults.
    exp_weight = EXP_WEIGHT * CRIT_EXP_MULTIPLIER if critical else EXP_WEIGHT

    candidates = []
    for e in pool:
        has_skill = category in (e.skills or [])
        skill_match = 1.0 if has_skill else SKILL_BASE

        # load_factor: 0 tasks -> 1.0 ; >= MAX_LOAD tasks -> 0.0
        load_factor = max(0.0, min(1.0, (MAX_LOAD - e.active_tasks) / MAX_LOAD))

        # speed_factor: min-max over the pool; if all equal, neutral 0.5
        m = mttrs[e.id]
        speed_factor = (max_m - m) / (max_m - min_m) if max_m > min_m else 0.5

        # exp_factor: min-max over the pool; if all equal, neutral 0.5
        ex = exps[e.id]
        exp_factor = (ex - min_e) / (max_e - min_e) if max_e > min_e else 0.5

        # zone_factor: 1.0 when the engineer is in the machine's zone (a small
        # same-zone bonus); 0.0 otherwise, and always 0.0 when the record has no
        # zone. A skilled other-zone engineer still beats an unskilled local one.
        eng_zone = getattr(e, "zone", None)
        same_zone = bool(machine_zone) and eng_zone == machine_zone
        zone_factor = 1.0 if same_zone else 0.0

        score = (
            SKILL_WEIGHT * skill_match
            + LOAD_WEIGHT * load_factor
            + MTTR_WEIGHT * speed_factor
            + exp_weight * exp_factor
            + ZONE_WEIGHT * zone_factor
        )

        candidates.append(
            {
                "engineer_id": e.id,
                "engineer_name": e.name,
                "has_skill": has_skill,
                "skill_match": round(skill_match, 3),
                "load_factor": round(load_factor, 3),
                "speed_factor": round(speed_factor, 3),
                "exp_factor": round(exp_factor, 3),
                "zone": eng_zone,
                "same_zone": same_zone,
                "zone_factor": round(zone_factor, 3),
                "active_tasks": e.active_tasks,
                "max_capacity": e.max_capacity,
                "mttr_minutes": m,
                "experience_years": ex,
                "score": round(score, 4),
            }
        )

    # Highest score wins; tie-break deterministically by engineer_id.
    candidates.sort(key=lambda c: (-c["score"], c["engineer_id"]))
    best = candidates[0]

    return {
        "assigned": True,
        "engineer_id": best["engineer_id"],
        "engineer_name": best["engineer_name"],
        "fault_category": category,
        "score": best["score"],
        "critical": critical,
        "safety_critical": safety_critical,
        "cap_overridden": cap_overridden,
        "staffing_escalation": False,
        "machine_zone": machine_zone,
        "reasoning": _reasoning(best, category, critical, safety_critical,
                                cap_overridden, machine_zone),
        "candidates": candidates,
        "excluded_at_capacity": excluded_at_capacity,
    }


def record_assignment(record: dict, result: dict, session) -> Assignment:
    """Persist an assignment and increment the chosen engineer's active_tasks.

    Side-effecting on purpose - kept SEPARATE from assign_engineer so scoring can
    be tested without touching the DB. Safe to call with an 'unassigned' result
    (engineer_id None): it records the unassigned fault and increments nobody.
    """
    # Snapshot the MACHINE's zone (A-D) onto the row so Stage 3b+ can scope a
    # field_manager by machine zone, independent of who responds. FAIL-SAFE: a
    # missing/blank zone stores NULL — never crashes, never changes assignment.
    machine_zone = str(record.get("zone", "") or "").strip() or None

    assignment = Assignment(
        alarm_id=record.get("alarm_id"),
        machine=record.get("Machine"),
        zone=machine_zone,
        fault_category=result.get("fault_category", "general"),
        engineer_id=result.get("engineer_id"),
        engineer_name=result.get("engineer_name"),
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


# ----------------------------------------------------------------------
# De-duplication lookup (read-only).
# ----------------------------------------------------------------------

# Statuses that count as an OPEN (unresolved) task. A task in either state is
# still on the technician's queue; only "resolved" frees the (machine, category)
# slot for a brand-new task. Mirrors lifecycle.get_active_assignments, which
# lists everything with status != "resolved".
OPEN_STATUSES = ("assigned", "in_progress")


def find_open_assignment(session, machine, fault_category):
    """Return the most-recent OPEN (unresolved) Assignment for this exact
    (machine, fault_category), or None.

    Used to DE-DUPLICATE: a developing fault re-emits a Warning every fleet
    sweep, but it is ONE physical fault, so we must not persist a NEW task while
    an open one already exists. Once that task is resolved (status 'resolved',
    which this query excludes), a genuinely recurring fault is free to create a
    fresh task. Read-only - writes nothing."""
    return (
        session.query(Assignment)
        .filter(Assignment.machine == machine)
        .filter(Assignment.fault_category == fault_category)
        .filter(Assignment.status.in_(OPEN_STATUSES))
        .order_by(Assignment.assigned_at.desc())
        .first()
    )
