"""
Seed realistic demo data for the engineer-assignment subsystem.

Running `python seed.py` WIPES and RE-FILLS the database (drop -> create ->
insert), so it is fully idempotent: run it as many times as you like and you
always get the same clean fixture.

The roster is hand-built to tell a clear story when scored (see
test_assignment.py):
  - Ravi   : mechanical specialist, light load   -> wins MECHANICAL faults
  - Priya  : electrical engineer, moderate load   -> wins ELECTRICAL faults
             (because Diego, the faster electrical hand, is UNAVAILABLE)
  - Sam    : thermal/process engineer             -> wins THERMAL faults
  - Lena   : generalist (all skills), fast general-> wins GENERAL faults
  - Chen   : mechanical, but OVERLOADED (9 tasks) -> loses MECHANICAL to Ravi
             despite a fast bearing MTTR (low load_factor drags the score down)
  - Diego  : electrical, fastest MTTR, UNAVAILABLE-> never selected (skipped)
"""

from db import Engineer, FaultMTTR, get_session, reset_db


# (name, role, skills, active_tasks, available)
ENGINEERS = [
    ("Ravi Kumar", "Mechanical / Bearing Specialist", ["mechanical"], 1, True),
    ("Priya Nair", "Electrical Engineer", ["electrical"], 2, True),
    ("Sam Okafor", "Thermal / Process Engineer", ["thermal"], 1, True),
    ("Lena Vogel", "Generalist", ["mechanical", "electrical", "thermal", "general"], 2, True),
    ("Chen Wei", "Mechanical Engineer (overloaded)", ["mechanical"], 9, True),
    ("Diego Santos", "Electrical Specialist (off shift)", ["electrical"], 0, False),
]

# Per-engineer MTTR (minutes) by fault category. Lower = faster. These are set
# so different engineers are demonstrably faster at different categories.
#   key = engineer name -> { category: mttr_minutes }
MTTR = {
    "Ravi Kumar": {"mechanical": 12, "electrical": 60, "thermal": 55, "general": 30},
    "Priya Nair": {"mechanical": 50, "electrical": 15, "thermal": 45, "general": 28},
    "Sam Okafor": {"mechanical": 48, "electrical": 52, "thermal": 14, "general": 26},
    "Lena Vogel": {"mechanical": 30, "electrical": 30, "thermal": 30, "general": 18},
    "Chen Wei": {"mechanical": 13, "electrical": 70, "thermal": 65, "general": 40},
    "Diego Santos": {"mechanical": 70, "electrical": 11, "thermal": 65, "general": 40},
}


def seed():
    """Wipe and re-fill the database with the demo roster + MTTR history."""
    reset_db()
    session = get_session()
    try:
        by_name = {}
        for name, role, skills, active_tasks, available in ENGINEERS:
            eng = Engineer(
                name=name,
                role=role,
                skills=skills,
                active_tasks=active_tasks,
                available=available,
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
