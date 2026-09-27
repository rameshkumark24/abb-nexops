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

- **Docker** with Compose v2 — for the one-command stack below, **or**
- **Python 3.11+** and **Node.js 20.9+** (required by Next.js 16) for local development

---

## Run the whole stack with Docker (recommended)

```bash
cp .env.example .env          # optional — every setting has a working default
docker compose up -d --build
```

Open **http://localhost** and log in (see *Demo logins*). This starts five containers:

| Service | Role |
|---------|------|
| `caddy` | the ONLY public entry point (`:80`, and `:443` with automatic HTTPS when `SITE_ADDRESS` is a domain) |
| `frontend` | Next.js app; proxies `/api/*` **and the `/api/ws` WebSocket** to the backend, so the browser talks to one origin |
| `backend` | FastAPI bridge; private to the compose network; SQLite + JWT secret persisted on the `backend-data` volume |
| `mosquitto` | MQTT broker; private to the compose network |
| `publisher` | telemetry simulator feeding the broker |

Health: `docker compose ps` (all `healthy`/`running`), backend readiness at `/api/healthz`.

---

## Deployment

### Single host (VM / on-prem edge box)

1. Point a DNS record at the host, then in `.env` set:
   ```
   SITE_ADDRESS=nexops.example.com   # Caddy fetches + renews a Let's Encrypt cert
   COOKIE_SECURE=1                   # cookies only over HTTPS
   NEXOPS_SEED_PASSWORD=<strong password>   # applied when the DB is first seeded
   NEXOPS_JWT_SECRET=<python -c "import secrets; print(secrets.token_hex(32))">
   ```
2. `docker compose up -d --build`. Data survives redeploys (`backend-data` volume).
   To reseed from scratch: `docker compose down -v` (deletes the volume).

Notes:
- The backend runs **one worker by design** (live machine state, WebSocket clients,
  MQTT subscription and the login rate limiter are in-process).
- For Postgres, set `DATABASE_URL` on the backend (`postgres://` URLs are accepted).
- To connect a real gateway instead of the simulator, drop the `publisher` service and
  secure the broker (see `deploy/mosquitto.conf`: credentials + TLS, then
  `MQTT_USERNAME`/`MQTT_PASSWORD`/`MQTT_TLS=1` on the backend).

### Vercel (frontend) + Render (backend) — free tier

The backend must be a Render **Web Service** (not a Static Site):

| Setting | Value |
|---------|-------|
| Runtime | Python |
| Build command | `pip install -r nexops-backend/requirements.txt` |
| Start command | `cd nexops-backend && uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers` |
| Env | `PYTHON_VERSION=3.11.11`, `EMBEDDED_SIMULATOR=1`, `MQTT_ENABLED=0`, `COOKIE_SECURE=1`, `FORWARDED_ALLOW_IPS=*`, `TZ=Asia/Kolkata` (the plant's timezone), optionally `NEXOPS_JWT_SECRET`, `GEMINI_API_KEY` / `GROQ_API_KEY` |

`EMBEDDED_SIMULATOR=1` generates the telemetry inside the backend, so no MQTT broker or
publisher service is needed. To run the generator as its **own service** instead
(the [`abb-datagenerator`](https://github.com/rameshkumark24/abb-datagenerator) repo), set
`INGEST_TOKEN=<long random secret>` and `EMBEDDED_SIMULATOR=0` on the backend, and run the
generator with `PUBLISHER=http`, `INGEST_URL=https://<backend>/ingest/telemetry` and the same
`INGEST_TOKEN`: it POSTs each record over HTTPS, so no broker is needed there either. On Vercel set **`BACKEND_ORIGIN=https://<service>.onrender.com`**
and redeploy: the live-feed WebSocket then connects straight to `wss://<service>.onrender.com/ws`
automatically (Vercel's proxy can't carry WebSockets).

### Split hosting (e.g. frontend on Vercel, backend on a container host)

- Deploy `nexops-backend/` with its `Dockerfile` (mount a volume at `/data`, or use
  Postgres via `DATABASE_URL`) and point `MQTT_HOST` at your broker.
- Deploy `abb-prototype-main/` with **build-time** env `BACKEND_ORIGIN=https://<backend>`.
  Vercel's rewrites don't carry WebSockets, so also set
  `NEXT_PUBLIC_WS_URL=wss://<backend>/ws` (ticket-authenticated; the CSP allows it
  automatically). Set `COOKIE_SECURE=1` on the backend.
- **Free-tier sleep (Render etc.):** the backend spins down after ~15 min idle.
  `.github/workflows/keepalive.yml` pings `/api/healthz` every 10 min to keep it
  awake (set the repo variable `KEEPALIVE_URL` to ping the backend directly). If it
  does sleep, the login page wakes it and retries automatically ("WAKING SERVER…")
  instead of failing with 503. Note that Render's free disk is ephemeral: with the
  default SQLite, data resets on every restart/redeploy — attach a disk at `/data`
  or use Postgres via `DATABASE_URL` for persistence.

---

## Local development (4 terminals)

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
uvicorn main:app --host 0.0.0.0 --port 8000
# First run auto-creates + seeds the demo roster AND loads the ARIA
# industrial-QA knowledge base from NexOps-Industrial-QA.pdf (background).
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
- `.env.example` — docker compose: public address/HTTPS, secrets, seed password, ARIA keys
- `nexops-backend/.env.example` — JWT secret, cookie/proxy flags, ARIA keys, MQTT, DB, CORS
- `abb-prototype-main/.env.example` — backend origin (build-time), optional WS URL override
- `nexops-data-generator` — `MQTT_HOST`, `MQTT_PORT`, `PUBLISH_INTERVAL_SECONDS` env vars

For production set at minimum: `NEXOPS_JWT_SECRET`, `COOKIE_SECURE=1`, `CORS_ORIGINS`, and (for live ARIA) `GEMINI_API_KEY` / `GROQ_API_KEY`. Without LLM keys, ARIA serves a deterministic offline template.

---

## Tests

```bash
cd nexops-backend
python -m pytest -q          # 93 tests: anomaly, risk, assignment, scoping, auth, ARIA, lifecycle, hardening …
python test_assignment.py    # readable role-allocation scenarios
cd ../abb-prototype-main
npm run typecheck            # frontend type check (npm run build for the full build)
```

---

## Security notes (prototype)

- Auth is JWT in an **httpOnly cookie** (XSS-safe), with **CSRF double-submit** and **server-side revocation** (logout / deactivation). The Next proxy keeps the cookie first-party.
- Demo password is shared and printed at seed time — **demo only**.
- LLM keys are read from the environment (never hardcode them in source).
- The live WebSocket feed and REST snapshot are **zone-scoped** server-side. WebSocket
  sessions are re-validated against the DB, so logout / deactivation also cut off an
  already-open live feed.
- ARIA answers are rendered through an allow-list formatter (only `<b> <i> <u> <br>`
  survive), since they are built from LLM output and telemetry text.
- CI (`.github/workflows/ci.yml`) runs the backend tests, the frontend typecheck/build and
  the Docker image builds on every PR.
