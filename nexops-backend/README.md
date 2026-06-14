# nexops-backend

A small **FastAPI bridge** that connects our MQTT telemetry feed to the browser.

It does exactly one job:

1. **Subscribe** to the Mosquitto broker (topics `nexops/refinery/telemetry/#`).
2. **Normalize** each record's field names through `adapter.normalize()` (the one
   place real ABB field names get mapped to ours later).
3. **Broadcast** every record to all connected browsers over **WebSocket**.

No machine learning, no databases, no ARIA yet — those are clearly marked
`TODO(Stage: ...)` insertion points in `main.py`.

```
 simulator/publisher ──MQTT──▶ Mosquitto ──▶ nexops-backend ──WebSocket──▶ browser
```

## Files

| File              | Role                                                  |
|-------------------|-------------------------------------------------------|
| `config.py`       | Host/port config (single place for demo-day swaps)    |
| `adapter.py`      | `FIELD_MAP` + `normalize()` — the rename choke point   |
| `main.py`         | FastAPI app: MQTT subscriber + WebSocket fan-out       |
| `requirements.txt`| Dependencies                                          |
| `test_ws.html`    | Standalone browser test page                           |

## Run order (Windows-friendly)

**1. Install dependencies** (from this folder):

```powershell
pip install -r requirements.txt
```

**2. Make sure the broker and the simulator publisher are running.**
From the `nexops-data-generator` folder (separate windows):

```powershell
.\start-broker.ps1        # Mosquitto broker on localhost:1883
.\start-publisher.ps1     # publishes telemetry to MQTT
```

> If you don't see records later, it's almost always because one of these two
> isn't running. Start them first.

**3. Start this backend** (run from inside `C:\nexops-backend`):

```powershell
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

> Plain `uvicorn main:app ...` also works. `main.py` puts its own folder on
> `sys.path`, so the local `config` / `adapter` imports resolve regardless of
> how you launch it or what your current directory is.

> **Windows Firewall popup:** the first time, Windows may ask to allow Python
> network access. Click **Allow access** — otherwise the browser can't reach the
> WebSocket.

**4. Verify it's up.**

- Open <http://localhost:8000/> in a browser → you should see
  `{"status":"ok","clients":0}`.
- Open **`test_ws.html`** (double-click the file, or drag it into a browser).

## What success looks like

`test_ws.html` shows **CONNECTED** in green, then prints a new line for every
telemetry record as it publishes, e.g.:

```
2026-06-14 14:25:58  Heat Exchanger  [Warning]  Cooling Efficiency Trend — Heat Exchanger Fouling developing ...
```

The `clients` count at <http://localhost:8000/> will increase while the test
page is open.

## Frontend integration

The Next.js app connects to:

```
ws://localhost:8000/ws
```

This is the same URL `test_ws.html` uses — once the test page works, the React
app will too.
