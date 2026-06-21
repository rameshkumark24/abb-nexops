"""
Central configuration for the NexOps backend bridge.

This is the SINGLE place where demo-day IP / port swaps happen. Everything
can be overridden with environment variables, but sensible localhost defaults
are provided so it "just works" on a laptop.
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file if it exists
load_dotenv()

# --- MQTT (where the simulator publishes telemetry) ---
MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
# Wildcard subscription: every per-machine topic under the base.
MQTT_TOPIC = os.environ.get("MQTT_TOPIC", "nexops/refinery/telemetry/#")

# --- WebSocket / HTTP server (what the browser connects to) ---
WS_HOST = os.environ.get("WS_HOST", "0.0.0.0")
WS_PORT = int(os.environ.get("WS_PORT", "8000"))

# --- Database (engineer-assignment subsystem; STANDALONE for now) ---
# Postgres-first, SQLite-fallback so it runs with ZERO setup. The default is a
# local SQLite file; point DATABASE_URL at Postgres to upgrade (needs the
# psycopg2-binary driver - see requirements.txt):
#   postgresql://user:pass@localhost:5432/nexops
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///nexops.db")

# --- CORS (browser origins allowed to call the API) ---
# Comma-separated list of allowed origins. Defaults to the local Next.js dev
# origins so it "just works" on a laptop; set CORS_ORIGINS to your REAL frontend
# origin(s) in production (a wildcard "*" is invalid with credentialed requests,
# so the origins must be named explicitly).
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if o.strip()
]

# --- Auth cookies ---
# Set COOKIE_SECURE=1 in production so the session/CSRF cookies are only sent over
# HTTPS. Default OFF so the cookies work on plain-http localhost during dev.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "").strip().lower() in ("1", "true", "yes")

# --- Reverse-proxy trust (login rate limiting) ---
# When the app sits behind a trusted reverse proxy / load balancer, the direct
# peer IP is the PROXY's, so per-IP login throttling would bucket every user
# together (lock everyone out, or be meaningless). Set TRUST_PROXY=1 to instead
# read the real client IP from the left-most X-Forwarded-For entry. Default OFF,
# because X-Forwarded-For is client-spoofable unless a trusted proxy sets it.
TRUST_PROXY = os.environ.get("TRUST_PROXY", "").strip().lower() in ("1", "true", "yes")
