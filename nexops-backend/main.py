"""
NexOps backend bridge: MQTT telemetry -> WebSocket fan-out.

ONE job: subscribe to the Mosquitto broker, normalize each record's field
names via adapter.normalize(), and broadcast it to every connected browser
over WebSocket. No ML, no databases, no ARIA here - those are marked TODO
insertion points only.

THREAD -> ASYNCIO HAND-OFF (the tricky bit)
-------------------------------------------
paho-mqtt's network loop runs in its OWN background thread (loop_start), so
its on_message callback fires on a non-asyncio thread. WebSocket sends are
async and belong to the FastAPI/uvicorn event loop. You must NOT touch async
objects from the MQTT thread directly.

The bridge: at startup we capture the running event loop. The MQTT callback
(sync thread) schedules the async broadcast onto that loop with
`asyncio.run_coroutine_threadsafe(coro, loop)`. This is thread-safe and is the
canonical way to push from a worker thread into asyncio - no shared mutable
state is touched across threads except via this scheduling call.
"""

import asyncio
import json
import os
import sys

# Make local modules (config.py, adapter.py) resolve no matter how the app is
# launched - `uvicorn main:app`, `python -m uvicorn main:app`, or from any CWD.
# We put THIS file's own directory on sys.path before the local imports below.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import paho.mqtt.client as mqtt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import config
from adapter import normalize

app = FastAPI(title="NexOps MQTT->WebSocket Bridge")

# CORS: allow all origins for the demo so the Next.js app on :3000 can hit
# the HTTP/WS endpoints on :8000 without preflight headaches.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------------------------
# Connection manager: tracks live WebSocket clients and fans out records.
# ----------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active:
            self.active.remove(websocket)

    async def broadcast(self, record: dict):
        """Send one record (as JSON) to every client. A dropped client must
        not kill the loop, so each send is isolated; failed clients are
        pruned afterwards."""
        payload = json.dumps(record)
        dead: list[WebSocket] = []
        for ws in list(self.active):
            try:
                await ws.send_text(payload)
            except Exception:
                # client vanished mid-send; mark for removal, keep going
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()

# Captured at startup so the MQTT thread can schedule coroutines onto it.
event_loop: asyncio.AbstractEventLoop | None = None

# Kept so we can stop the network loop cleanly on shutdown.
mqtt_client: mqtt.Client | None = None


# ----------------------------------------------------------------------
# MQTT callbacks (these run on paho's background thread, NOT asyncio)
# ----------------------------------------------------------------------

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[mqtt] connected to {config.MQTT_HOST}:{config.MQTT_PORT}")
        client.subscribe(config.MQTT_TOPIC)
        print(f"[mqtt] subscribed to {config.MQTT_TOPIC}")
    else:
        print(f"[mqtt] connect failed (rc={rc})")


def on_message(client, userdata, msg):
    try:
        raw = json.loads(msg.payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        print(f"[mqtt] skipping bad message on {msg.topic}: {exc}")
        return

    # The ONE normalization choke point.
    record = normalize(raw)

    # ---- Later-stage insertion points (NOT implemented in this task) ----
    # TODO(Stage: anomaly) run Isolation Forest here, attach anomaly_score
    # TODO(Stage: history) write record to InfluxDB here
    # TODO(Stage: assignment) enrich with engineer assignment from Postgres here
    # TODO(Stage: ARIA) attach ARIA explanation here
    # ---------------------------------------------------------------------

    # Hand off from this sync MQTT thread to the asyncio event loop.
    if event_loop is not None:
        asyncio.run_coroutine_threadsafe(manager.broadcast(record), event_loop)


# ----------------------------------------------------------------------
# FastAPI lifecycle: start/stop the MQTT network loop
# ----------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    global event_loop, mqtt_client
    # Capture the loop the WebSocket sends must run on.
    event_loop = asyncio.get_running_loop()

    mqtt_client = mqtt.Client()
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    mqtt_client.reconnect_delay_set(min_delay=1, max_delay=30)
    try:
        mqtt_client.connect(config.MQTT_HOST, config.MQTT_PORT)
    except Exception as exc:
        # Don't crash the API if the broker isn't up yet; paho will retry
        # once it can reach the host.
        print(f"[mqtt] initial connect to {config.MQTT_HOST}:{config.MQTT_PORT} "
              f"failed: {exc} (will keep retrying)")
    # Run paho's network loop on its own background thread.
    mqtt_client.loop_start()


@app.on_event("shutdown")
async def shutdown():
    if mqtt_client is not None:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()


# ----------------------------------------------------------------------
# HTTP + WebSocket endpoints
# ----------------------------------------------------------------------

@app.get("/")
async def health():
    """Simple health check - open in a browser to confirm the service is up."""
    return {"status": "ok", "clients": len(manager.active)}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # We only push to the browser; we don't expect inbound messages, but
        # we must keep reading so disconnects are detected promptly.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.WS_HOST, port=config.WS_PORT)
