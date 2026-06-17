"""
Stage 3b — server-side role + zone SCOPING.

The rule lives in ONE place so it can't drift. It is applied on TOP of auth
(Stage 3a) to every data-returning endpoint and every write action. DEFAULT-DENY:
an unrecognized role, a missing zone / engineer link, or any uncertainty yields
the EMPTY result (reads) or a forbidden write — NEVER the full unscoped data.

ZONE KEYING PER MODEL (inspected)
---------------------------------
  - Engineer   : has its OWN `zone` column -> filter directly (scope_engineer_query).
  - Assignment : has NO zone column. It stores `machine` (a NAME string) and
      `engineer_id`; the machine->zone map lives ONLY in the frontend, not the DB.
      So a task's zone is taken from its ASSIGNED ENGINEER's zone via a JOIN
      Assignment.engineer_id -> Engineer.zone. In the normal same-zone routing
      case this equals the machine's zone; for a cross-zone FALLBACK dispatch the
      task surfaces under the RESPONDING engineer's zone (the manager of whoever
      is actually handling it). UNASSIGNED tasks (engineer_id NULL) have no zone
      and are therefore visible only to the plant_manager — default-deny means
      they can never leak to the WRONG zone.
  - Machine / alert / prediction : NOT REST resources — they flow over the /ws
      feed, which 3b leaves UNSCOPED (see the /ws TODO in main.py). No REST
      scoping is required for them here.

ROLE MATRIX
-----------
  plant_manager -> everything, no filter.
  field_manager -> only tasks whose assigned engineer is in his zone; engineers
                   in his zone.
  technician    -> only his OWN tasks (Assignment.engineer_id == engineer_id);
                   read-only on others.
"""

from sqlalchemy import false

from db import Assignment, Engineer

PLANT = "plant_manager"
FIELD = "field_manager"
TECH = "technician"


class ScopeForbidden(Exception):
    """A write the current user is NOT allowed to perform (maps to HTTP 403)."""


def scope_assignment_query(query, current_user):
    """Apply the role/zone/engineer filter to an Assignment SELECT.

    DEFAULT-DENY: an unknown role or a missing scoping key returns an EMPTY
    result (false()), never the unscoped query.
    """
    role = getattr(current_user, "role", None)

    if role == PLANT:
        return query  # all zones, everything — no filter

    if role == FIELD:
        zone = getattr(current_user, "zone", None)
        if not zone:
            return query.filter(false())  # field manager with no zone -> nothing
        # MACHINE zone (Assignment.zone), NOT the responding engineer's zone, and
        # NO join. Consequences (both intentional):
        #   - a CROSS-ZONE fallback task (machine zone C, engineer zone D) is
        #     visible to field_manager C — the machine's zone, who actually owns
        #     the asset — not to field_manager D.
        #   - an UNASSIGNED task (engineer_id NULL) in zone C is STILL visible to
        #     field_manager C, because the zone is on the row, not derived from an
        #     engineer. (The old engineer-join hid these.)
        return query.filter(Assignment.zone == zone)

    if role == TECH:
        # UNCHANGED: technicians are scoped to their OWN tasks (their engineer_id),
        # never by zone — they see only what is theirs to act on.
        eng_id = getattr(current_user, "engineer_id", None)
        if eng_id is None:
            return query.filter(false())  # technician not linked -> nothing
        return query.filter(Assignment.engineer_id == eng_id)

    # Unrecognized / missing role -> default-deny.
    return query.filter(false())


def scope_engineer_query(query, current_user):
    """Apply the role/zone filter to an Engineer SELECT (direct `zone` column).

    No REST engineer endpoint exists yet, but the model's rule lives HERE so a
    future endpoint can't re-derive it differently. Same default-deny contract.
    """
    role = getattr(current_user, "role", None)

    if role == PLANT:
        return query
    if role == FIELD:
        zone = getattr(current_user, "zone", None)
        if not zone:
            return query.filter(false())
        return query.filter(Engineer.zone == zone)
    if role == TECH:
        eng_id = getattr(current_user, "engineer_id", None)
        if eng_id is None:
            return query.filter(false())
        return query.filter(Engineer.id == eng_id)
    return query.filter(false())


def can_write_assignment(assignment, current_user, session) -> bool:
    """May `current_user` START/RESOLVE this assignment?

      plant_manager -> yes (any task)
      technician    -> only his OWN task (engineer_id match)
      field_manager -> only if the task's MACHINE zone (Assignment.zone) is his
                       zone — so he can act on a cross-zone fallback task whose
                       machine is in his zone even if the responder is elsewhere
      unknown       -> no

    FAIL-SAFE: any error or missing link returns False (deny) — never True, so a
    scoping glitch can never authorize an out-of-scope write.
    """
    try:
        role = getattr(current_user, "role", None)

        if role == PLANT:
            return True

        if role == TECH:
            return (
                getattr(current_user, "engineer_id", None) is not None
                and assignment.engineer_id == current_user.engineer_id
            )

        if role == FIELD:
            zone = getattr(current_user, "zone", None)
            # Key off the MACHINE zone snapshotted on the row (not the engineer).
            return bool(zone) and assignment.zone == zone

        return False
    except Exception:
        return False
