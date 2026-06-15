"""
Seed realistic demo data for the engineer-assignment subsystem.

Running `python seed.py` WIPES and RE-FILLS the database (drop -> create ->
insert), so it is fully idempotent: run it as many times as you like and you
always get the same clean fixture.

The roster is hand-built to tell a clear story when scored (see
test_assignment.py):
  - Ravi   : SENIOR mechanical specialist (15y), light load -> wins MECHANICAL
  - Priya  : junior electrical (4y) but FAST + idle          -> wins NON-critical
             ELECTRICAL (Diego, faster still, is UNAVAILABLE)
  - Sam    : thermal/process engineer, part-timer (cap 3)    -> wins THERMAL
  - Lena   : generalist (all skills), fast general           -> wins GENERAL
  - Chen   : mechanical, AT CAPACITY (6/6)                    -> EXCLUDED by the
             hard cap (cannot take another task even though skilled)
  - Diego  : electrical, fastest MTTR, UNAVAILABLE            -> never selected
  - Hassan : SENIOR electrical lead (18y), slower + busier    -> wins a CRITICAL
             ELECTRICAL fault, where experience is weighted higher (tips it over
             the faster-but-junior Priya)
  - Mara   : hydraulics specialist, AT CAPACITY (6/6)         -> the ONLY skilled
             hydraulic hand, excluded by cap -> a hydraulic fault routes to the
             next-best generalist instead
"""

from db import Engineer, FaultMTTR, get_session, reset_db


# (name, role, skills, active_tasks, available, experience_years, max_capacity)
ENGINEERS = [
    ("Ravi Kumar", "Senior Mechanical / Bearing Specialist", ["mechanical"], 1, True, 15, 6),
    ("Priya Nair", "Electrical Engineer (junior, fast)", ["electrical"], 0, True, 4, 6),
    ("Sam Okafor", "Thermal / Process Engineer (part-time)", ["thermal"], 1, True, 7, 3),
    ("Lena Vogel", "Generalist", ["mechanical", "electrical", "thermal", "general"], 2, True, 6, 6),
    ("Chen Wei", "Mechanical Engineer (at capacity)", ["mechanical"], 6, True, 3, 6),
    ("Diego Santos", "Electrical Specialist (off shift)", ["electrical"], 0, False, 12, 6),
    ("Hassan Ali", "Senior Electrical Lead", ["electrical"], 4, True, 18, 6),
    ("Mara Singh", "Hydraulics Specialist (at capacity)", ["hydraulic"], 6, True, 10, 6),
]

# Per-engineer MTTR (minutes) by fault category. Lower = faster. These are set
# so different engineers are demonstrably faster at different categories.
#   key = engineer name -> { category: mttr_minutes }
MTTR = {
    "Ravi Kumar": {"mechanical": 12, "electrical": 60, "thermal": 55, "general": 30, "hydraulic": 60},
    "Priya Nair": {"mechanical": 50, "electrical": 12, "thermal": 45, "general": 28, "hydraulic": 55},
    "Sam Okafor": {"mechanical": 48, "electrical": 52, "thermal": 14, "general": 26, "hydraulic": 50},
    "Lena Vogel": {"mechanical": 30, "electrical": 30, "thermal": 30, "general": 18, "hydraulic": 35},
    "Chen Wei": {"mechanical": 13, "electrical": 70, "thermal": 65, "general": 40, "hydraulic": 60},
    "Diego Santos": {"mechanical": 70, "electrical": 11, "thermal": 65, "general": 40, "hydraulic": 60},
    "Hassan Ali": {"mechanical": 55, "electrical": 40, "thermal": 50, "general": 32, "hydraulic": 58},
    "Mara Singh": {"mechanical": 60, "electrical": 58, "thermal": 55, "general": 38, "hydraulic": 12},
}


def seed():
    """Wipe and re-fill the database with the demo roster + MTTR history."""
    reset_db()
    session = get_session()
    try:
        by_name = {}
        for name, role, skills, active_tasks, available, experience_years, max_capacity in ENGINEERS:
            eng = Engineer(
                name=name,
                role=role,
                skills=skills,
                active_tasks=active_tasks,
                available=available,
                experience_years=experience_years,
                max_capacity=max_capacity,
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
        print(f"[seed] inserted {len(ENGINEERS)} engineers and "
              f"{sum(len(c) for c in MTTR.values())} MTTR rows.")
    finally:
        session.close()


if __name__ == "__main__":
    seed()
