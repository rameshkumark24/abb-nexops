"""
Publisher for the ABB-gateway simulator feed
============================================
This sits on top of `simulator.py`. The simulator's job is to GENERATE
records; this file's job is to PUBLISH them somewhere.

Stage 1:  ConsolePublisher - just prints each record.
Stage 2:  MqttPublisher    - pushes each record to an MQTT broker so
                             downstream NexOps services can subscribe.
                             Now fully implemented (needs paho-mqtt).

The record-pulling logic lives entirely in the simulator: we import
`generate_next_record` and feed whatever it returns into the selected
publisher. We never reach into the simulator's internals or duplicate its
schema.
"""

import json
import os
import time

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
TOTAL_RECORDS = None

# Seconds between records. Defaults to the simulator's own interval so the
# feed rate matches `python simulator.py`.
PUBLISH_INTERVAL_SECONDS = INTERVAL_SECONDS

# --- MQTT broker settings (used by MqttPublisher) ---
MQTT_HOST = "localhost"      # broker hostname / IP
MQTT_PORT = 1883             # broker port (1883 = plain MQTT, 8883 = TLS)
MQTT_TOPIC = "nexops/refinery/telemetry"   # base topic; per-machine suffix added
MQTT_QOS = 1                 # at-least-once delivery

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
        self.client = mqtt.Client()
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        # paho retries the connection automatically between these bounds
        # after an unexpected drop, giving us basic reconnect resilience.
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)

    # -- callbacks --------------------------------------------------------

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self.connected = True
            print(f"[mqtt] connected to {self.host}:{self.port}")
        else:
            self.connected = False
            print(f"[mqtt] connect failed (rc={rc})")

    def _on_disconnect(self, client, userdata, rc):
        self.connected = False
        if rc != 0:
            print(f"[mqtt] unexpected disconnect (rc={rc}); auto-reconnecting...")
        else:
            print("[mqtt] disconnected")

    # -- lifecycle --------------------------------------------------------

    def connect(self):
        """Connect to the broker and start the background network loop."""
        try:
            self.client.connect(self.host, self.port)
        except Exception as exc:
            raise RuntimeError(
                f"[mqtt] could not reach broker at {self.host}:{self.port}: {exc}\n"
                "Is a broker running? See the 'Stage 2: Running with MQTT' "
                "section of README.md."
            )
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

def make_publisher(name=PUBLISHER):
    """Return a publisher instance for the configured name.
    Defaults to ConsolePublisher for any unknown value."""
    if name == "mqtt":
        return MqttPublisher(MQTT_HOST, MQTT_PORT, MQTT_TOPIC, MQTT_QOS)
    return ConsolePublisher()


# ----------------------------------------------------------------------
# Main loop: pull records from the simulator, send them to the publisher
# ----------------------------------------------------------------------

def main():
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
