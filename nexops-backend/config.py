"""
Central configuration for the NexOps backend bridge.

This is the SINGLE place where demo-day IP / port swaps happen. Everything
can be overridden with environment variables, but sensible localhost defaults
are provided so it "just works" on a laptop.
"""

import os

# --- MQTT (where the simulator publishes telemetry) ---
MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
# Wildcard subscription: every per-machine topic under the base.
MQTT_TOPIC = os.environ.get("MQTT_TOPIC", "nexops/refinery/telemetry/#")

# --- WebSocket / HTTP server (what the browser connects to) ---
WS_HOST = os.environ.get("WS_HOST", "0.0.0.0")
WS_PORT = int(os.environ.get("WS_PORT", "8000"))
