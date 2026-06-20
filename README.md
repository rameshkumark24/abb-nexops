# NexOps — Predictive Refinery Monitoring & Dispatch (Prototype)

NexOps turns a raw industrial telemetry feed into **early fault prediction**, **noise-filtered risk**, and **automatic engineer dispatch** — across a zone-structured plant, with a role-aware dashboard and an in-context AI assistant (ARIA).

It is a faithfully **scaled-down slice** of a 500-machine / 250-technician plant: 26 refinery assets across 4 zones (A–D), staffed by 16 engineers (4 per zone).

---

## What it does (the golden path)

1. A simulator emits realistic ABB-800xA-style telemetry (26 assets, ISA tags, real units, cascading faults with an incubation window, EEMUA-191 nuisance texture).
2. The backend **augments** every reading: an online Isolation-Forest **anomaly score** → a fused **NexOps risk** → an **EARLY** catch when it sees drift *before* the static threshold trips → **engineer assignment** (skill-first, zone-preferring, critical-aware) → site-emergency tagging.
3. Enriched records stream to the browser over a **zone-scoped WebSocket**; three role dashboards (Plant Manager / Field Manager / Technician) render risk, the EARLY badge, nuisance filtering, dispatch, and a red-zone banner.
4. **ARIA** answers operational questions, scoped to the user's zone.

---

## Architecture

```
nexops-data-generator/   simulator + MQTT publisher (telemetry source)
        │  MQTT (nexops/refinery/telemetry/#)
        ▼
nexops-backend/          FastAPI bridge + intelligence + auth
        │  on_message: normalize → anomaly → risk → EARLY → assignment → site-alert
        │  REST (/api, httpOnly cookie + CSRF)   WebSocket (/ws, ticket-auth, zone-scoped)
        ▼
abb-prototype-main/      Next.js app — 3 role dashboards + ARIA panel
```

Key backend modules: `anomaly.py` (Isolation Forest), `risk.py` (risk fusion), `assignment.py` (weighted dispatch), `aria.py` (zone-scoped assistant), `auth_jwt.py` + `scoping.py` (auth + role/zone scoping), `lifecycle.py` (task states).

---

## Prerequisites

- **Python 3.11+** and **Node.js 18+**
- **Docker** (only for the MQTT broker; optional — the backend runs without it, just with no live feed)

---

## Quickstart (4 terminals)

### 1. MQTT broker (optional but needed for the live feed)
```bash
cd nexops-data-generator
# Docker:
docker run -d --name nexops-broker -p 1883:1883 eclipse-mosquitto
# (Windows helpers: ./start-broker.ps1 / ./stop-broker.ps1)
```

### 2. Backend
```bash
cd nexops-backend
pip install -r requirements.txt
python seed_qa.py          # one-time: load the ARIA industrial-QA knowledge base
uvicorn main:app --host 0.0.0.0 --port 8000
# (auto-creates + seeds the demo roster on first run)
```

### 3. Telemetry publisher
```bash
cd nexops-data-generator
pip install -r requirements.txt
PUBLISHER=mqtt python publisher.py     # Windows PS: $env:PUBLISHER="mqtt"; python publisher.py
```

### 4. Frontend
```bash
cd abb-prototype-main
npm install
npm run dev        # http://localhost:3000
```

Open **http://localhost:3000** and log in.

---

## Demo logins (demo only — not production-safe)

Password for **all** users: `nexops123` (override with `NEXOPS_SEED_PASSWORD`).

| Username | Role | Sees |
|----------|------|------|
| `plant` | Plant Manager | all zones |
| `fieldA`…`fieldD` | Field Manager | their zone only |
| `ravi`, `boris`, `chen`, `mara`, … | Technician | their own tasks |

---

## Configuration

Copy `*.env.example` files and adjust as needed — **everything has localhost defaults, so the demo runs with nothing set**:
- `nexops-backend/.env.example` — JWT secret, cookie/proxy flags, ARIA keys, DB, CORS
- `abb-prototype-main/.env.example` — backend origin, WS URL

For production set at minimum: `NEXOPS_JWT_SECRET`, `COOKIE_SECURE=1`, `CORS_ORIGINS`, and (for live ARIA) `GEMINI_API_KEY` / `GROQ_API_KEY`. Without LLM keys, ARIA serves a deterministic offline template.

---

## Tests

```bash
cd nexops-backend
python -m pytest -q          # 82 tests: anomaly, risk, assignment, scoping, auth, ARIA, lifecycle …
python test_assignment.py    # readable role-allocation scenarios
cd ../abb-prototype-main
npx tsc --noEmit             # frontend type check
```

---

## Security notes (prototype)

- Auth is JWT in an **httpOnly cookie** (XSS-safe), with **CSRF double-submit** and **server-side revocation** (logout / deactivation). The Next proxy keeps the cookie first-party.
- Demo password is shared and printed at seed time — **demo only**.
- LLM keys are read from the environment (never hardcode them in source).
- The live WebSocket feed and REST snapshot are **zone-scoped** server-side.
