"""
Publisher for the ABB-gateway simulator feed
============================================
This sits on top of `simulator.py`. The simulator's job is to GENERATE
records; this file's job is to PUBLISH them somewhere.

Stage 1:  ConsolePublisher - just prints each record.
Stage 2:  MqttPublisher    - pushes each record to an MQTT broker so
                             downstream NexOps services can subscribe.
                             Now fully implemented (needs paho-mqtt).
Stage 3:  HttpPublisher    - POSTs each record to the NexOps backend's HTTPS
                             ingest endpoint (PUBLISHER=http). No broker
                             needed; stdlib only. For cloud deployments.

The record-pulling logic lives entirely in the simulator: we import
`generate_next_record` and feed whatever it returns into the selected
publisher. We never reach into the simulator's internals or duplicate its
schema.
"""

import json
import os
import signal
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from simulator import generate_next_record, INTERVAL_SECONDS

# ----------------------------------------------------------------------
# CONFIG  (edit here, not inline below)
# ----------------------------------------------------------------------

# Which publisher to use: "console" (default) or "mqtt".
# Can be overridden at runtime with the PUBLISHER env var, e.g.
#   PUBLISHER=mqtt python publisher.py
# Console stays the zero-dependency default fallback.
PUBLISHER = os.environ.get("PUBLISHER", "console").strip().lower()

# How long to run. None = run forever, or set an integer record limit.
TOTAL_RECORDS = int(os.environ["TOTAL_RECORDS"]) if os.environ.get("TOTAL_RECORDS") else None

# Seconds between records. Defaults to the simulator's own interval so the
# feed rate matches `python simulator.py`.
PUBLISH_INTERVAL_SECONDS = float(os.environ.get("PUBLISH_INTERVAL_SECONDS", INTERVAL_SECONDS))

# --- MQTT broker settings (used by MqttPublisher) ---
# Env-overridable so the publisher runs unchanged in a container / on another
# host (e.g. MQTT_HOST=mosquitto under docker compose).
MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")    # broker hostname / IP
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))    # 1883 plain, 8883 TLS
MQTT_TOPIC = os.environ.get("MQTT_BASE_TOPIC", "nexops/refinery/telemetry")  # per-machine suffix added
MQTT_QOS = int(os.environ.get("MQTT_QOS", "1"))         # at-least-once delivery
MQTT_USERNAME = os.environ.get("MQTT_USERNAME", "")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "")
MQTT_TLS = os.environ.get("MQTT_TLS", "").strip().lower() in ("1", "true", "yes")
# Seconds to keep retrying the FIRST connection (the broker may still be
# starting). 0 = fail immediately, as before.
MQTT_CONNECT_WAIT_SECONDS = float(os.environ.get("MQTT_CONNECT_WAIT_SECONDS", "60"))

# --- HTTPS ingest settings (used by HttpPublisher, PUBLISHER=http) ---
# POST each record straight to the NexOps backend — no MQTT broker needed, which
# suits cloud deployments. INGEST_TOKEN must match the backend's INGEST_TOKEN.
INGEST_URL = os.environ.get("INGEST_URL", "").strip()
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "").strip()
INGEST_TIMEOUT_SECONDS = float(os.environ.get("INGEST_TIMEOUT_SECONDS", "20"))

# Optional health endpoint. When PORT (or HEALTH_PORT) is set, a tiny HTTP server
# answers GET / and /healthz with the publisher's status — required to run as a
# web service on hosts that expect a bound port (e.g. Render), and usable by
# uptime monitors. Unset = no server.
HEALTH_PORT = os.environ.get("HEALTH_PORT") or os.environ.get("PORT")

# ----------------------------------------------------------------------
# Optional dependency guard
# The MqttPublisher needs paho-mqtt. Guard the import so this module still
# loads (and ConsolePublisher still works) even when paho-mqtt is missing.
# ----------------------------------------------------------------------

try:
    import paho.mqtt.client as mqtt
    _HAS_PAHO = True
except ImportError:
    mqtt = None
    _HAS_PAHO = False


# ----------------------------------------------------------------------
# Publisher interface + implementations
# ----------------------------------------------------------------------

class Publisher:
    """Base interface. A publisher takes a record dict and sends it out."""

    def connect(self):
        """Open any connection needed. No-op by default."""
        pass

    def publish(self, record):
        raise NotImplementedError

    def disconnect(self):
        """Release any resources (connections, sockets). No-op by default."""
        pass

    # Backwards-compatible alias.
    def close(self):
        self.disconnect()


class ConsolePublisher(Publisher):
    """Stage 1 publisher: print each record as a JSON line to stdout."""

    def publish(self, record):
        print(json.dumps(record))


class MqttPublisher(Publisher):
    """Stage 2 publisher: push each record to an MQTT broker.

    Each record is published to a PER-MACHINE topic derived from the base
    topic plus the (slugified) machine name, e.g.

        nexops/refinery/telemetry/cooling_tower

    so subscribers can filter per machine (or use a wildcard like
    `nexops/refinery/telemetry/#` to get everything).
    """

    def __init__(self, host=MQTT_HOST, port=MQTT_PORT, topic=MQTT_TOPIC,
                 qos=MQTT_QOS):
        if not _HAS_PAHO:
            raise RuntimeError(
                "paho-mqtt is not installed. Install it with:\n"
                "    pip install paho-mqtt\n"
                "(or: pip install -r requirements.txt)"
            )
        self.host = host
        self.port = port
        self.base_topic = topic
        self.qos = qos
        self.connected = False
        # paho-mqtt 2.x callback API (VERSION1 is deprecated).
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if MQTT_USERNAME:
            self.client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD or None)
        if MQTT_TLS:
            self.client.tls_set()
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        # paho retries the connection automatically between these bounds
        # after an unexpected drop, giving us basic reconnect resilience.
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)

    # -- callbacks --------------------------------------------------------

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if not reason_code.is_failure:
            self.connected = True
            print(f"[mqtt] connected to {self.host}:{self.port}")
        else:
            self.connected = False
            print(f"[mqtt] connect failed ({reason_code})")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None):
        self.connected = False
        if reason_code.is_failure:
            print(f"[mqtt] unexpected disconnect ({reason_code}); auto-reconnecting...")
        else:
            print("[mqtt] disconnected")

    # -- lifecycle --------------------------------------------------------

    def connect(self):
        """Connect to the broker and start the background network loop.

        Retries for up to MQTT_CONNECT_WAIT_SECONDS so the publisher can start
        alongside the broker (e.g. under docker compose) instead of crashing."""
        deadline = time.monotonic() + MQTT_CONNECT_WAIT_SECONDS
        delay = 1.0
        while True:
            try:
                self.client.connect(self.host, self.port)
                break
            except Exception as exc:
                if time.monotonic() >= deadline:
                    raise RuntimeError(
                        f"[mqtt] could not reach broker at {self.host}:{self.port}: {exc}\n"
                        "Is a broker running? See the 'Stage 2: Running with MQTT' "
                        "section of README.md."
                    )
                print(f"[mqtt] broker {self.host}:{self.port} not reachable yet "
                      f"({exc}); retrying in {delay:.0f}s...")
                time.sleep(delay)
                delay = min(delay * 2, 10.0)
        # loop_start runs the network loop (incl. auto-reconnect) in a thread.
        self.client.loop_start()

    def topic_for(self, record):
        """Per-machine topic: base + slugified machine name."""
        machine = str(record.get("Machine", "unknown"))
        slug = machine.replace(" ", "_").lower()
        return f"{self.base_topic}/{slug}"

    def publish(self, record):
        """Publish one record. A failed publish is logged, never fatal."""
        try:
            topic = self.topic_for(record)
            payload = json.dumps(record)
            info = self.client.publish(topic, payload, qos=self.qos)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                print(f"[mqtt] publish failed (rc={info.rc}) to {topic}")
        except Exception as exc:
            # Never let one bad publish kill the main loop.
            print(f"[mqtt] publish error: {exc}")

    def disconnect(self):
        """Stop the network loop and disconnect cleanly."""
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception as exc:
            print(f"[mqtt] error during disconnect: {exc}")


# ----------------------------------------------------------------------
# Publisher selection
# ----------------------------------------------------------------------

class HttpPublisher(Publisher):
    """POST each record to the NexOps backend's HTTPS ingest endpoint
    (POST /ingest/telemetry, `Authorization: Bearer <INGEST_TOKEN>`).

    Stdlib only. Failures never stop the feed: a sleeping/restarting backend
    (e.g. a free-tier host waking up) just drops those ticks, and each failure
    streak is logged once plus a summary when delivery recovers."""

    def __init__(self, url=INGEST_URL, token=INGEST_TOKEN,
                 timeout=INGEST_TIMEOUT_SECONDS):
        if not url or not token:
            raise RuntimeError(
                "PUBLISHER=http needs INGEST_URL (e.g. https://<backend>/ingest/telemetry) "
                "and INGEST_TOKEN (the backend's INGEST_TOKEN).")
        self.url = url
        self.token = token
        self.timeout = timeout
        self.failures = 0  # consecutive failed publishes

    def connect(self):
        print(f"[http] publishing to {self.url}")

    def publish(self, record):
        req = urllib.request.Request(
            self.url,
            data=json.dumps(record).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
                "User-Agent": "nexops-data-generator",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                res.read()
            if self.failures:
                print(f"[http] delivery restored after {self.failures} failed record(s)")
            self.failures = 0
            STATUS["published"] += 1
            STATUS["last_error"] = None
        except urllib.error.HTTPError as exc:
            reason = {401: "backend rejected INGEST_TOKEN",
                      404: "ingest disabled on backend (INGEST_TOKEN not set there)",
                      413: "batch too large"}.get(exc.code, f"HTTP {exc.code}")
            self._failed(reason)
        except Exception as exc:  # URLError, timeout, connection reset...
            self._failed(f"{type(exc).__name__}: {getattr(exc, 'reason', exc)}")

    def _failed(self, reason):
        self.failures += 1
        STATUS["failed"] += 1
        STATUS["last_error"] = reason
        if self.failures == 1:
            print(f"[http] publish failed: {reason} (will keep retrying each tick)")


# Shared publisher status, served by the optional health endpoint.
STATUS = {"published": 0, "failed": 0, "last_error": None, "started": time.time()}


def start_health_server(port):
    """Serve GET / and /healthz with the publisher status on 0.0.0.0:<port>."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path not in ("/", "/healthz"):
                self.send_error(404)
                return
            body = json.dumps({"status": "ok", "publisher": PUBLISHER,
                               "uptime_s": int(time.time() - STATUS["started"]),
                               **{k: v for k, v in STATUS.items() if k != "started"}})
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body.encode("utf-8"))

        do_HEAD = do_GET

        def log_message(self, *args):  # keep stdout for the feed logs
            pass

    server = ThreadingHTTPServer(("0.0.0.0", int(port)), Handler)
    threading.Thread(target=server.serve_forever, name="health", daemon=True).start()
    print(f"[health] status endpoint on :{port}/healthz")
    return server


def make_publisher(name=PUBLISHER):
    """Return a publisher instance for the configured name.
    Defaults to ConsolePublisher for any unknown value."""
    if name == "mqtt":
        return MqttPublisher(MQTT_HOST, MQTT_PORT, MQTT_TOPIC, MQTT_QOS)
    if name == "http":
        return HttpPublisher()
    return ConsolePublisher()


# ----------------------------------------------------------------------
# Main loop: pull records from the simulator, send them to the publisher
# ----------------------------------------------------------------------

def _raise_keyboard_interrupt(signum, frame):
    raise KeyboardInterrupt


def main():
    # `docker stop` / systemd send SIGTERM: treat it like CTRL+C so the loop
    # exits through the same clean-disconnect path.
    signal.signal(signal.SIGTERM, _raise_keyboard_interrupt)
    if HEALTH_PORT:
        start_health_server(HEALTH_PORT)
    publisher = make_publisher(PUBLISHER)
    publisher.connect()
    print(f"Publishing simulator feed via {type(publisher).__name__} "
          f"(every {PUBLISH_INTERVAL_SECONDS}s). Press CTRL+C to stop.")

    alarm_id = 1
    try:
        while TOTAL_RECORDS is None or alarm_id <= TOTAL_RECORDS:
            record = generate_next_record(alarm_id)
            publisher.publish(record)
            alarm_id += 1
            time.sleep(PUBLISH_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("\nPublisher stopped by user.")
    finally:
        publisher.disconnect()


if __name__ == "__main__":
    main()
