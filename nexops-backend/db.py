"""
Database layer for the engineer-assignment subsystem.

POSTGRES-FIRST, SQLITE-FALLBACK
-------------------------------
The same SQLAlchemy models run on either backend, so the system works with ZERO
setup (a local SQLite file) and upgrades to Postgres just by pointing
DATABASE_URL at it - no code changes:

    SQLite (default, zero setup):
        sqlite:///nexops.db

    Postgres (opt-in):
        set DATABASE_URL=postgresql://user:pass@localhost:5432/nexops
        (requires psycopg2-binary - see requirements.txt)

DATABASE_URL precedence: explicit env var > config.py > zero-setup SQLite file.

This module is STANDALONE: it is NOT imported by the live MQTT->WebSocket bridge
(main.py). The assignment system is proven on its own (seed.py +
test_assignment.py) before it is ever wired into the bridge.
"""

import os
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

# Resolve the connection URL. config.py already folds in the DATABASE_URL env
# var, but we also honour the env var directly so db.py works even if imported
# without config present, and we always have a safe SQLite default.
try:
    import config

    _CONFIG_URL = getattr(config, "DATABASE_URL", None)
except Exception:  # pragma: no cover - config is optional for standalone use
    _CONFIG_URL = None

DATABASE_URL = os.environ.get("DATABASE_URL") or _CONFIG_URL or "sqlite:///nexops.db"

# SQLite + multithreaded access needs check_same_thread=False; harmless here and
# omitted for Postgres.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, future=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, future=True)

Base = declarative_base()


# ----------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------

class Engineer(Base):
    """A field engineer the assignment engine can pick from."""

    __tablename__ = "engineers"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    role = Column(String, nullable=False)
    # skills: JSON list of skill tags, e.g. ["mechanical", "electrical"].
    # SQLAlchemy's JSON type stores this natively on Postgres and as TEXT on
    # SQLite (3.9+), so the same column works on both backends.
    skills = Column(JSON, nullable=False, default=list)
    active_tasks = Column(Integer, nullable=False, default=0)
    available = Column(Boolean, nullable=False, default=True)
    # experience_years: drives the EXPERIENCE factor in scoring (weighs heavier
    # for Critical faults).
    experience_years = Column(Integer, nullable=False, default=0)
    # max_capacity: HARD cap on concurrent active tasks. An engineer with
    # active_tasks >= max_capacity is excluded from assignment entirely (this is
    # separate from the soft load_factor nudge).
    max_capacity = Column(Integer, nullable=False, default=6)
    # zone: which plant ZONE (A|B|C|D) this engineer belongs to. Stage 1 of the
    # zone hierarchy. DESIGN CHOICE: we keep zone as a simple STRING on the
    # engineer (the "simpler option") rather than a separate Zone reference table
    # - there is nothing yet to hang off a Zone row (the plant-manager / zone-
    # manager USER roles arrive in a later stage), so a string is enough for the
    # assignment engine to PREFER same-zone engineers. nullable=True keeps the
    # column purely ADDITIVE: pre-existing rows / records without a zone still
    # load, and the engine treats a missing zone as "no zone preference".
    zone = Column(String, nullable=True)
    # active: SOFT-DELETE flag (Stage 3d). An inactive engineer is EXCLUDED from
    # assignment eligibility but its rows (and assignment history allocation
    # depends on) are NEVER deleted. Defaulted True so it is additive; an existing
    # SQLite DB must be RESEEDED (python seed.py / reset_db) for the column to
    # exist, since create_all does not ALTER an existing table.
    active = Column(Boolean, nullable=False, default=True)

    mttr = relationship(
        "FaultMTTR", back_populates="engineer", cascade="all, delete-orphan"
    )


class FaultMTTR(Base):
    """Historical mean-time-to-resolve for one engineer on one fault category.

    The logical key is (engineer_id, fault_category); a surrogate integer PK is
    used because every table needs a primary key and a composite PK would add no
    value here.
    """

    __tablename__ = "fault_mttr"

    id = Column(Integer, primary_key=True)
    engineer_id = Column(Integer, ForeignKey("engineers.id"), nullable=False)
    fault_category = Column(String, nullable=False)
    mttr_minutes = Column(Float, nullable=False)

    engineer = relationship("Engineer", back_populates="mttr")


class Assignment(Base):
    """A persisted assignment of an alarm/fault to an engineer, with lifecycle.

    Lifecycle: status moves assigned -> in_progress -> resolved. Resolving stamps
    resolved_at, computes resolution_minutes, and (in lifecycle.resolve_task)
    decrements the engineer's active_tasks to free capacity.
    """

    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True)
    alarm_id = Column(Integer, nullable=True)
    machine = Column(String, nullable=True)
    # zone: the MACHINE's plant zone (A-D) at assignment time, snapshotted from
    # record["zone"]. Stage 3b+ scopes a field_manager to the MACHINE's zone via
    # THIS column (not the responding engineer's zone), so a cross-zone fallback
    # task and an unassigned task both stay visible to the machine's zone manager.
    # nullable=True keeps it ADDITIVE/back-compat: old rows (pre-column) read NULL.
    zone = Column(String, nullable=True)
    fault_category = Column(String, nullable=False)
    engineer_id = Column(Integer, ForeignKey("engineers.id"), nullable=True)
    # engineer_name: denormalized snapshot so a summary/queue can show who was
    # assigned without a join (and survives even if the roster later changes).
    engineer_name = Column(String, nullable=True)
    assigned_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    # status: "assigned" | "in_progress" | "resolved"
    status = Column(String, nullable=False, default="assigned")
    # score: the match score the engine used to choose this engineer.
    score = Column(Float, nullable=True)
    # --- lifecycle timestamps (additive) ---
    started_at = Column(DateTime, nullable=True)   # set when -> in_progress
    resolved_at = Column(DateTime, nullable=True)  # set when -> resolved
    # elapsed assigned_at -> resolved_at, in minutes; computed on resolve.
    resolution_minutes = Column(Float, nullable=True)


class User(Base):
    """An authenticated console user (Stage 3a auth foundation).

    ADDITIVE auth layer. Reuses the existing engineers as the TECHNICIAN layer:
    a technician User LINKS to an Engineer row via engineer_id (nullable FK), so
    the roster stays the single source of truth for field staff and the
    engineers table is NEVER modified here. Plant / field managers carry no
    engineer link (engineer_id NULL).
    """

    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    # role: 'plant_manager' | 'field_manager' | 'technician'
    role = Column(String, nullable=False)
    # zone: NULL for plant_manager (whole site); 'A'-'D' for field_manager /
    # technician. For technicians this mirrors the linked Engineer.zone.
    zone = Column(String, nullable=True)
    # engineer_id: FK to engineers.id, set ONLY for technicians (NULL for the
    # manager roles). Additive link — the engineers table is left untouched.
    engineer_id = Column(Integer, ForeignKey("engineers.id"), nullable=True)
    # active: mirrors the linked Engineer's soft-delete flag (Stage 3d). Set
    # False when the technician is deactivated. NOT enforced in login here (auth
    # logic is unchanged); assignment eligibility keys off Engineer.active.
    active = Column(Boolean, nullable=False, default=True)


class IndustrialQA(Base):
    """Industrial maintenance Q&A knowledge base seeded from NexOps-Industrial-QA.pdf.

    Covers 38 equipment/operations sections (403 Q&A pairs total). Used by ARIA
    to answer maintenance and troubleshooting questions using keyword-scored retrieval.
    """

    __tablename__ = "industrial_qa"

    id = Column(Integer, primary_key=True)
    section_number = Column(Integer, nullable=False, index=True)
    section_name = Column(String, nullable=False, index=True)
    question = Column(String, nullable=False)
    answer = Column(String, nullable=False)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def init_db():
    """Create all tables if they don't already exist (no-op if present)."""
    Base.metadata.create_all(engine)


def reset_db():
    """Drop and recreate all tables - used by seed.py for a clean reseed."""
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def get_session():
    """Return a new Session. The caller is responsible for closing it."""
    return SessionLocal()
