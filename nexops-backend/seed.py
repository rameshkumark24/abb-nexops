"""
Seed realistic demo data for the engineer-assignment subsystem.

Running `python seed.py` WIPES and RE-FILLS the database (drop -> create ->
insert), so it is fully idempotent: run it as many times as you like and you
always get the same clean fixture.

ZONE-STRUCTURED ROSTER (Stage 1 of the zone hierarchy)
------------------------------------------------------
The roster is organised into 4 plant ZONES (A/B/C/D) with exactly 4 engineers
each (16 total). With ~26 zone-tagged machines that is a ~1:1.6 tech:machine
ratio, close to the pitch ratio (~250 techs : 500 machines = 1:2). Every zone
keeps MECHANICAL, ELECTRICAL and THERMAL coverage so same-zone routing can find
a skilled LOCAL hand. Hydraulics is deliberately scarce - only ONE hydraulic
specialist exists, in Zone D - so a hydraulic fault anywhere else must FALL BACK
across zones.

The roster is hand-built to tell a clear story when scored (see
test_assignment.py). Key archetypes (zones in brackets):
  - Ravi  [A] : SENIOR mechanical specialist (15y), light load -> wins a ZONE-A
                MECHANICAL fault, edging out the EQUALLY-skilled Boris [B] purely
                on the same-zone bonus (proves zone is the tiebreaker).
  - Boris [B] : SENIOR mechanical specialist (15y), identical stats to Ravi but a
                different zone -> would win the SAME fault if it were in Zone B.
  - Priya [B] : junior electrical (4y) but FAST + idle -> wins a NON-critical
                ELECTRICAL fault in Zone B (Diego, faster still, is UNAVAILABLE).
  - Hassan[B] : SENIOR electrical lead (18y), slower + busier -> wins a CRITICAL
                ELECTRICAL fault in Zone B, where experience is weighted higher
                (tips it over the faster-but-junior Priya; both are Zone B so the
                zone bonus cancels and EXPERIENCE decides).
  - Diego [A] : electrical, fastest MTTR, UNAVAILABLE -> never selected (proves
                the availability filter). His zone is irrelevant since he is
                filtered out everywhere; Zone A's AVAILABLE electrical cover is
                the generalist Lena.
  - Sam   [A] : thermal/process engineer, part-timer (cap 3) -> wins a Zone-A
                THERMAL fault.
  - Lena  [A] : generalist (all skills), fast general -> wins a Zone-A GENERAL
                fault (and is Zone A's available electrical/thermal back-up).
  - Chen  [C] : mechanical, AT CAPACITY (6/6) -> EXCLUDED by the hard cap (Yuki
                is Zone C's available mechanical).
  - Mara  [D] : the ONLY hydraulic specialist (Zone D) -> a hydraulic fault in
                Zone C (no local hydraulic hand) FALLS BACK to her across zones.

Skill stays DOMINANT in scoring; zone is only a small same-zone bonus (see
assignment.ZONE_WEIGHT), so a skilled other-zone engineer always beats an
unskilled same-zone one - that is exactly what makes cross-zone fallback work.
"""

import os

from db import Engineer, FaultMTTR, User, get_session, reset_db

# Shared seed password for EVERY seeded user, hashed at seed time. OVERRIDABLE via
# NEXOPS_SEED_PASSWORD so a deployer can set a real password without code changes.
# The fallback 'nexops123' is a DEMO-ONLY convenience (one known password, printed
# to the console) so the operator can log in as any role instantly — NOT
# production-safe. Real deployments should set NEXOPS_SEED_PASSWORD (or move to
# per-user provisioning).
DEV_PASSWORD = os.environ.get("NEXOPS_SEED_PASSWORD", "nexops123")
_SEED_PASSWORD_IS_DEFAULT = "NEXOPS_SEED_PASSWORD" not in os.environ


# (name, role, skills, active_tasks, available, experience_years, max_capacity, zone)
# 16 engineers: exactly 4 per zone (A/B/C/D); each zone keeps mechanical /
# electrical / thermal coverage (the 4th slot is a generalist or extra specialist).
ENGINEERS = [
    # ---------------- Zone A ----------------
    ("Ravi Kumar", "Senior Mechanical / Bearing Specialist", ["mechanical"], 0, True, 15, 6, "A"),
    ("Sam Okafor", "Thermal / Process Engineer (part-time)", ["thermal"], 0, True, 7, 3, "A"),
    ("Lena Vogel", "Generalist", ["mechanical", "electrical", "thermal", "general"], 0, True, 6, 6, "A"),
    ("Diego Santos", "Electrical Specialist (off shift)", ["electrical"], 0, False, 12, 6, "A"),
    # ---------------- Zone B ----------------
    ("Boris Petrov", "Senior Mechanical Specialist", ["mechanical"], 0, True, 15, 6, "B"),
    ("Priya Nair", "Electrical Engineer (junior, fast)", ["electrical"], 0, True, 4, 6, "B"),
    ("Hassan Ali", "Senior Electrical Lead", ["electrical"], 0, True, 18, 6, "B"),
    ("Omar Farah", "Thermal / Process Engineer", ["thermal"], 0, True, 7, 6, "B"),
    # ---------------- Zone C ----------------
    ("Chen Wei", "Mechanical Engineer (at capacity)", ["mechanical"], 0, True, 3, 6, "C"),
    ("Yuki Tanaka", "Mechanical Engineer", ["mechanical"], 0, True, 11, 6, "C"),
    ("Carlos Mendez", "Electrical Engineer", ["electrical"], 0, True, 9, 6, "C"),
    ("Fatima Noor", "Thermal Engineer", ["thermal"], 0, True, 10, 6, "C"),
    # ---------------- Zone D ----------------
    ("Mara Singh", "Hydraulics Specialist (only one on site)", ["hydraulic"], 0, True, 10, 6, "D"),
    ("Liam O'Brien", "Mechanical Engineer", ["mechanical"], 0, True, 12, 6, "D"),
    ("Wei Zhang", "Electrical Engineer", ["electrical"], 0, True, 9, 6, "D"),
    ("Hana Kim", "Thermal Engineer", ["thermal"], 0, True, 8, 6, "D"),
]


def _mttr(**overrides):
    """Per-category MTTR (minutes) with sensible 'slow' defaults; pass the
    engineer's SPECIALTY categories as fast overrides. Lower = faster. The
    defaults make an engineer look SLOW at categories outside their specialty
    (so specialists win their own category and generalists stay middling)."""
    base = {"mechanical": 50, "electrical": 50, "thermal": 50, "general": 30, "hydraulic": 55}
    base.update(overrides)
    return base


# Per-engineer MTTR by fault category. Tuned so different engineers are
# demonstrably faster at different categories (drives the speed_factor term).
# Exactly the 16 kept engineers - no rows for dropped engineers.
MTTR = {
    # ---- Zone A ----
    "Ravi Kumar": _mttr(mechanical=12),
    "Sam Okafor": _mttr(thermal=14, general=26),
    "Lena Vogel": _mttr(mechanical=30, electrical=30, thermal=30, general=18, hydraulic=35),
    "Diego Santos": _mttr(electrical=11),                 # fastest, but UNAVAILABLE
    # ---- Zone B ----
    "Boris Petrov": _mttr(mechanical=12),                 # identical to Ravi
    "Priya Nair": _mttr(electrical=12, general=28),
    "Hassan Ali": _mttr(electrical=40, general=32),
    "Omar Farah": _mttr(thermal=26),
    # ---- Zone C ----
    "Chen Wei": _mttr(mechanical=13),                     # fast but AT CAPACITY
    "Yuki Tanaka": _mttr(mechanical=16),
    "Carlos Mendez": _mttr(electrical=20),
    "Fatima Noor": _mttr(thermal=18),
    # ---- Zone D ----
    "Mara Singh": _mttr(hydraulic=12),                    # ONLY hydraulic specialist
    "Liam O'Brien": _mttr(mechanical=18),
    "Wei Zhang": _mttr(electrical=20),
    "Hana Kim": _mttr(thermal=20),
}


def seed_users(session=None):
    """Wipe and re-seed ONLY the `users` table from the CURRENT engineers roster.

    Idempotent: deletes every existing user and rebuilds 1 plant_manager + 4
    field_managers + one technician per engineer. Does NOT touch the engineers
    table or any other table — safe to re-run any time.

    Pass an existing `session` (e.g. from seed()) to run inside that transaction;
    called with no args it opens/commits/closes its own session so it can be run
    standalone against an already-seeded engineers roster.
    """
    # Local import keeps seed.py importable even where auth deps aren't needed
    # until users are actually seeded.
    from auth_jwt import hash_password

    owns_session = session is None
    if owns_session:
        session = get_session()
    try:
        pw = hash_password(DEV_PASSWORD)

        # WIPE users only (additive reseed; engineers/MTTR/assignments untouched).
        session.query(User).delete()
        session.flush()

        creds = []  # (username, role, zone) for the printed credentials table
        used = set()  # collision guard across all usernames

        def add_user(username, role, zone, engineer_id):
            session.add(User(username=username, password_hash=pw, role=role,
                             zone=zone, engineer_id=engineer_id))
            used.add(username)
            creds.append((username, role, zone))

        # 1 plant manager (whole site -> zone NULL).
        add_user("plant", "plant_manager", None, None)

        # 4 field managers, one per zone.
        for z in ("A", "B", "C", "D"):
            add_user(f"field{z}", "field_manager", z, None)

        # 16 technicians: one per existing engineer. username = lowercased first
        # name, collision-safe (append zone, then id). zone + engineer_id mirror
        # the engineer.
        engineers = session.query(Engineer).order_by(Engineer.id).all()
        for eng in engineers:
            base = (eng.name.split()[0] if eng.name else f"eng{eng.id}").lower()
            uname = base
            if uname in used:
                uname = f"{base}{(eng.zone or '').lower()}"
            if uname in used:
                uname = f"{base}{eng.id}"
            add_user(uname, "technician", eng.zone, eng.id)

        if owns_session:
            session.commit()

        # CREDENTIALS table (demo operator login sheet). Only echo the password
        # when it's the built-in DEMO default; a deployer-set NEXOPS_SEED_PASSWORD
        # is never printed (don't leak a real credential into logs).
        print("[seed] users — DEMO credentials (NOT production-safe):")
        if _SEED_PASSWORD_IS_DEFAULT:
            print(f"       password for ALL users: {DEV_PASSWORD!r}")
        else:
            print("       password for ALL users: (set via NEXOPS_SEED_PASSWORD — not shown)")
        print(f"       {'username':<14}{'role':<16}zone")
        for uname, role, zone in creds:
            print(f"       {uname:<14}{role:<16}{zone or '-'}")
        print(f"[seed] inserted {len(creds)} users "
              f"(1 plant_manager + 4 field_managers + {len(creds) - 5} technicians).")
    finally:
        if owns_session:
            session.close()


def seed():
    """Wipe and re-fill the database with the demo roster + MTTR history."""
    reset_db()
    session = get_session()
    try:
        by_name = {}
        for name, role, skills, active_tasks, available, experience_years, max_capacity, zone in ENGINEERS:
            eng = Engineer(
                name=name,
                role=role,
                skills=skills,
                active_tasks=active_tasks,
                available=available,
                experience_years=experience_years,
                max_capacity=max_capacity,
                zone=zone,
            )
            session.add(eng)
            by_name[name] = eng
        session.flush()  # assign ids before inserting MTTR rows

        for name, cats in MTTR.items():
            eng = by_name[name]
            for category, minutes in cats.items():
                session.add(
                    FaultMTTR(
                        engineer_id=eng.id,
                        fault_category=category,
                        mttr_minutes=float(minutes),
                    )
                )

        # Stage 3a (additive): reseed the auth users from the roster we just
        # flushed (engineers now have ids). Reuses THIS session/transaction.
        seed_users(session)

        session.commit()
        print(f"[seed] inserted {len(ENGINEERS)} engineers (4 per zone, zones A/B/C/D) and "
              f"{sum(len(c) for c in MTTR.values())} MTTR rows.")
    finally:
        session.close()


if __name__ == "__main__":
    seed()
