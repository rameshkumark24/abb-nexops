# nexops-data-generator

A stand-in **ABB gateway** for the NexOps prototype. Real ABB 800xA gateways
stream live process telemetry and alarms off refinery equipment; this service
fakes that feed so the rest of NexOps can be built and demoed without the real
hardware.

It produces a realistic, noisy, **escalating** stream of sensor readings and
alarms across 16 refinery assets (compressors, pumps, boilers, fired heaters,
reactors, etc.), including slow *predictive* degradation faults that drift below
the static alarm limit before they trip — the centrepiece for demonstrating
early anomaly detection.

## Quick start (Windows + Docker)

New to all this? Follow these steps exactly. **MQTT** is just a messaging
system: a *broker* (the post office) receives messages and forwards them to
anyone who subscribed. Here the **publisher** sends telemetry, the **broker**
relays it, and the **subscriber** prints what it receives.

**One-time setup**

1. Install **Docker Desktop** (https://www.docker.com/products/docker-desktop)
   and **start it** — wait until its whale icon says "Docker Desktop is running".
   Docker is what runs the broker for us.
2. Install Python dependencies (in any PowerShell window, from this folder):
   ```powershell
   pip install -r requirements.txt
   ```

**Run the demo** — open **3 separate PowerShell windows** in this folder and run
one script in each, **in this order**:

| Window | Command                    | What it does                          |
|--------|----------------------------|---------------------------------------|
| 1      | `.\start-broker.ps1`       | starts the MQTT broker (the post office) |
| 2      | `.\start-subscriber.ps1`   | listens and prints incoming telemetry |
| 3      | `.\start-publisher.ps1`    | generates and publishes telemetry     |

> **Firewall popup:** the first time, Windows may show a **"Windows Defender
> Firewall"** dialog asking to allow Docker/Python network access. Click
> **Allow access** — otherwise the broker can't be reached.
>
> **"running scripts is disabled" error?** Run this once, then retry:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

**Success looks like:** Window 2 (the subscriber) starts printing telemetry
records, one per line, each tagged with a per-machine topic such as
`[nexops/refinery/telemetry/compressor] {"Machine": "Compressor", ...}`.

**When you're done:** press **CTRL+C** in windows 2 and 3, then run
`.\stop-broker.ps1` to shut down and remove the broker container.

## Components

| File              | Role                                                            |
|-------------------|-----------------------------------------------------------------|
| `simulator.py`    | Generates records. Stdlib only. Run it to print + log the feed. |
| `publisher.py`    | Pulls records from the simulator and publishes them.            |
| `requirements.txt`| Dependencies (Stage 1 needs none).                              |

A consumer pulls records by importing **`generate_next_record(alarm_id, phase=None)`**
from `simulator`. It returns one record dict per call, does no printing or file
writing, and (when `phase` is omitted) derives the demo-escalation phase itself.

## Record schema

Each record is a JSON object with these fields:

| Field               | Meaning                                                  |
|---------------------|----------------------------------------------------------|
| `Machine`           | Asset name (e.g. "Compressor")                           |
| `Timestamp`         | `YYYY-MM-DD HH:MM:SS` local time                          |
| `Temp` / `Pressure` / `Level` / `Flow` | Four common dashboard columns (any may be `null`) |
| `Status`            | `Normal` / `Warning` / `Critical`                        |
| `Alert`             | Short alert label (`None` when normal)                   |
| `features`          | Object of this machine's raw sensor readings             |
| `alarm_id`          | Monotonic tick id                                        |
| `scenario_name`     | Same as the alert label                                  |
| `alarm_type`        | `Process` / `Safety` / `Electrical` / `System` / `Predictive` |
| `alarm_priority`    | `Critical` / `High` / `Medium` / `Low`                   |
| `priority_level`    | Numeric priority (1=Critical … 4=Low)                    |
| `alarm_state`       | Lifecycle: `ACT` / `ACK` / `RTN`                         |
| `ack_state`         | `Unacknowledged` / `Acknowledged`                        |
| `is_predictive`     | `true` for early-warning (below static limit) alarms     |
| `object_name`       | Instrument tag (e.g. "PIC-CMP01")                        |
| `object_description`| Human description of the asset                           |
| `message`           | Full human-readable alarm message                        |

### Example record

```json
{
  "Machine": "Compressor",
  "Timestamp": "2026-06-14 10:23:45",
  "Temp": 58.4,
  "Pressure": 7.82,
  "Level": null,
  "Flow": null,
  "Status": "Normal",
  "Alert": "None",
  "features": {"gen_temp": 58.4, "comp_pressure": 7.82, "vibration": 1.6, "current": 24.3, "rpm": 1493.0},
  "alarm_id": 1,
  "scenario_name": "None",
  "alarm_type": "Process",
  "alarm_priority": "Low",
  "priority_level": 4,
  "alarm_state": "RTN",
  "ack_state": "Acknowledged",
  "is_predictive": false,
  "object_name": "PIC-CMP01",
  "object_description": "Process Gas Compressor Discharge",
  "message": "All parameters within normal operating range"
}
```

## Running

### Simulator (prints rows + appends JSONL)

```bash
python simulator.py
```

Prints a live formatted table and appends each record as one JSON line to
`refinery_live_data.jsonl`. Press **CTRL+C** to stop.

### Publisher (Stage 1: console)

```bash
python publisher.py
```

Pulls records from the simulator and prints each as a JSON line via the default
`ConsolePublisher`. Press **CTRL+C** to stop. Configuration (publisher choice,
interval, broker settings) lives in the `CONFIG` block at the top of
`publisher.py`.

## Stage 2: Running with MQTT

The `MqttPublisher` is now fully implemented. It publishes each record to a
**per-machine topic** derived from the base topic plus the slugified machine
name:

```
nexops/refinery/telemetry/<machine_name_lowercased_with_underscores>
```

e.g. `nexops/refinery/telemetry/cooling_tower`. Subscribe to
`nexops/refinery/telemetry/#` to receive every machine. Records are published
with **QoS 1**.

### 0. Start a broker (pick ONE)

**(a) Docker Mosquitto** — easiest if you have Docker:

```bash
docker run -it -p 1883:1883 eclipse-mosquitto
```

**(b) No-Docker fallback** — pure-Python broker via amqtt (use this if Docker
is not installed):

```bash
pip install amqtt
amqtt          # starts a broker listening on 0.0.0.0:1883
```

> The CONFIG defaults (`MQTT_HOST=localhost`, `MQTT_PORT=1883`) match both
> brokers above, so no config change is needed.

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Three-terminal run sequence

| Terminal | Command                                   | Purpose                |
|----------|-------------------------------------------|------------------------|
| 1        | start broker (Docker or amqtt, see above) | the MQTT broker        |
| 2        | `python subscriber_test.py`               | verify messages arrive |
| 3        | `PUBLISHER=mqtt python publisher.py`       | publish the feed       |

On Windows PowerShell, terminal 3 is:

```powershell
$env:PUBLISHER="mqtt"; python publisher.py
```

(You can also just set `PUBLISHER = "mqtt"` in the CONFIG block of
`publisher.py` instead of using the env var.)

### What success looks like

- Terminal 3 (publisher) prints `[mqtt] connected to localhost:1883`.
- Terminal 2 (subscriber) starts printing telemetry records, one per line,
  each prefixed with its per-machine topic, e.g.:

  ```
  [nexops/refinery/telemetry/compressor] {"Machine": "Compressor", "Timestamp": ...}
  [nexops/refinery/telemetry/pump] {"Machine": "Pump", ...}
  ```

If the broker is not running, the publisher exits with a clear "could not reach
broker" message; start the broker first.
