"""
Tiny standalone MQTT test subscriber.
Subscribes to every per-machine telemetry topic and prints each message
with its topic, so you can verify the publisher feed is flowing end-to-end.

Run while publisher.py (PUBLISHER=mqtt) is publishing:
    python subscriber_test.py
"""

import paho.mqtt.client as mqtt

# Reuse the same broker/topic config as the publisher.
from publisher import MQTT_HOST, MQTT_PORT, MQTT_TOPIC


def on_connect(client, userdata, flags, rc):
    print(f"[sub] connected (rc={rc}); subscribing to {MQTT_TOPIC}/#")
    client.subscribe(f"{MQTT_TOPIC}/#")


def on_message(client, userdata, msg):
    print(f"[{msg.topic}] {msg.payload.decode('utf-8', 'replace')}")


client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message
client.connect(MQTT_HOST, MQTT_PORT)
print("Listening for telemetry. Press CTRL+C to stop.")
client.loop_forever()
