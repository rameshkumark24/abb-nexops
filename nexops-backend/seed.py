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

from db import Engineer, FaultMTTR, get_session, reset_db


# (name, role, skills, active_tasks, available, experience_years, max_capacity, zone)
# 16 engineers: exactly 4 per zone (A/B/C/D); each zone keeps mechanical /
# electrical / thermal coverage (the 4th slot is a generalist or extra specialist).
ENGINEERS = [
    # ---------------- Zone A ----------------
    ("Ravi Kumar", "Senior Mechanical / Bearing Specialist", ["mechanical"], 1, True, 15, 6, "A"),
    ("Sam Okafor", "Thermal / Process Engineer (part-time)", ["thermal"], 1, True, 7, 3, "A"),
    ("Lena Vogel", "Generalist", ["mechanical", "electrical", "thermal", "general"], 2, True, 6, 6, "A"),
    ("Diego Santos", "Electrical Specialist (off shift)", ["electrical"], 0, False, 12, 6, "A"),
    # ---------------- Zone B ----------------
    ("Boris Petrov", "Senior Mechanical Specialist", ["mechanical"], 1, True, 15, 6, "B"),
    ("Priya Nair", "Electrical Engineer (junior, fast)", ["electrical"], 0, True, 4, 6, "B"),
    ("Hassan Ali", "Senior Electrical Lead", ["electrical"], 4, True, 18, 6, "B"),
    ("Omar Farah", "Thermal / Process Engineer", ["thermal"], 1, True, 7, 6, "B"),
    # ---------------- Zone C ----------------
    ("Chen Wei", "Mechanical Engineer (at capacity)", ["mechanical"], 6, True, 3, 6, "C"),
    ("Yuki Tanaka", "Mechanical Engineer", ["mechanical"], 1, True, 11, 6, "C"),
    ("Carlos Mendez", "Electrical Engineer", ["electrical"], 1, True, 9, 6, "C"),
    ("Fatima Noor", "Thermal Engineer", ["thermal"], 1, True, 10, 6, "C"),
    # ---------------- Zone D ----------------
    ("Mara Singh", "Hydraulics Specialist (only one on site)", ["hydraulic"], 1, True, 10, 6, "D"),
    ("Liam O'Brien", "Mechanical Engineer", ["mechanical"], 1, True, 12, 6, "D"),
    ("Wei Zhang", "Electrical Engineer", ["electrical"], 1, True, 9, 6, "D"),
    ("Hana Kim", "Thermal Engineer", ["thermal"], 1, True, 8, 6, "D"),
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

        session.commit()
        print(f"[seed] inserted {len(ENGINEERS)} engineers (4 per zone, zones A/B/C/D) and "
              f"{sum(len(c) for c in MTTR.values())} MTTR rows.")
    finally:
        session.close()


if __name__ == "__main__":
    seed()
