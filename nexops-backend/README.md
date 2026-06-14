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
| `anomaly.py`      | `AnomalyEngine` — online, per-machine Isolation Forest |
| `risk.py`         | `compute_nexops_risk()` — fuse gateway + anomaly view  |
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

## Anomaly detection (NexOps's own risk view)

The bridge no longer just passes records through — it **augments** each one with
NexOps's independent risk assessment, computed by an **Isolation Forest** anomaly
engine ([`anomaly.py`](anomaly.py)) fused with the gateway's static severity
([`risk.py`](risk.py)).

**What it does.** For every machine the engine keeps a rolling window of the most
recent ~200 feature vectors (the numeric values from each record's `features`
object, taken in a stable sorted-key order so the vector layout is consistent per
machine). It fits an Isolation Forest on that window and scores the current
reading against the machine's *own* recent history. The result is blended with the
gateway's `alarm_priority` and the record's `is_predictive` flag into a single
`nexops_risk` verdict.

**The point:** when the gateway still says *Normal/Low* but the reading is
drifting (high anomaly score) or is flagged predictive, `nexops_risk` rises
**above** the gateway level — NexOps catches the issue *before* the static
threshold does.

**Online, no pretraining.** The engine never trains on synthetic/offline data. It
learns purely from the live stream each machine actually produces.

**Warm-up behavior.** The first **~30 records per machine** (`MIN_TRAIN`) produce
**no score** — `anomaly_score` is `null` and `anomaly_status` is `"warming_up"`.
We do *not* fabricate a number before the model has enough history. After that,
the forest is **refit every 20 records** (`REFIT_EVERY`) rather than on every
reading, since fitting is the expensive part.

**Score normalization.** `anomaly_score` is a `0..1` value where **higher = more
anomalous**. It is a sigmoid applied to the negated Isolation Forest
`decision_function` (which is ~0 at the model's learned boundary, positive for
inliers, negative for outliers), so `0.5` ≈ on the boundary, `→1` ≈ strongly
anomalous, `→0` ≈ clearly normal.

**Fail-safe.** The entire anomaly step in `main.py` is wrapped in `try/except`. If
scoring ever errors, the record gets `anomaly_score=null`,
`anomaly_status="error"`, and a `nexops_risk` that simply **mirrors the gateway
priority** — the error is logged and the live feed keeps flowing.

### New record fields (added, never replacing existing ones)

| Field              | Type                | Meaning                                            |
|--------------------|---------------------|----------------------------------------------------|
| `anomaly_score`    | `float \| null`     | `0..1`, higher = more anomalous; `null` while warming up |
| `anomaly_status`   | `str`               | `"warming_up"` \| `"scored"` \| `"error"`          |
| `nexops_risk`      | `str`               | `"LOW"` \| `"MEDIUM"` \| `"HIGH"` \| `"CRITICAL"`   |
| `nexops_reasoning` | `str`               | short human explanation of the verdict             |

All original gateway fields (`Machine`, `Status`, `Alert`, `alarm_priority`,
`is_predictive`, `features`, …) are left **untouched**.

### Dependencies

The anomaly stage is now **required**. Install the new deps:

```powershell
pip install scikit-learn numpy
```

(Both are already listed in [`requirements.txt`](requirements.txt), so
`pip install -r requirements.txt` covers them too.)

## Frontend integration

The Next.js app connects to:

```
ws://localhost:8000/ws
```

This is the same URL `test_ws.html` uses — once the test page works, the React
app will too.
