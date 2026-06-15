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
    """A persisted assignment of an alarm/fault to an engineer."""

    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True)
    alarm_id = Column(Integer, nullable=True)
    machine = Column(String, nullable=True)
    fault_category = Column(String, nullable=False)
    engineer_id = Column(Integer, ForeignKey("engineers.id"), nullable=True)
    assigned_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    # status: "assigned" | "in_progress" | "resolved"
    status = Column(String, nullable=False, default="assigned")
    # score: the match score the engine used to choose this engineer.
    score = Column(Float, nullable=True)


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
