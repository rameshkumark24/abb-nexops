# NexOps backend (FastAPI + MQTT bridge + anomaly/assignment engines).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Run unprivileged. /data holds everything that must survive a redeploy: the
# SQLite DB and the auto-generated JWT secret (when NEXOPS_JWT_SECRET is unset).
RUN useradd --system --uid 10001 nexops \
    && mkdir -p /data && chown nexops /data
USER nexops
VOLUME ["/data"]

ENV DATABASE_URL=sqlite:////data/nexops.db \
    NEXOPS_JWT_SECRET_FILE=/data/.jwt_secret \
    WS_HOST=0.0.0.0 \
    WS_PORT=8000 \
    # uvicorn reads this: which proxy IPs may set X-Forwarded-For. "*" is only
    # safe because the backend is NOT published — it is reachable solely by the
    # frontend proxy on the private network (see docker-compose.yml). Narrow it
    # if you expose the backend directly.
    FORWARDED_ALLOW_IPS=*

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"

# ONE worker on purpose: live machine state, the WebSocket client list, the
# MQTT subscription and the login rate limiter are in-process state.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--workers", "1"]
