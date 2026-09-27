# NexOps telemetry simulator -> MQTT publisher (stand-in for the ABB gateway).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY simulator.py publisher.py ./

RUN useradd --system --uid 10001 nexops
USER nexops

ENV PUBLISHER=mqtt \
    MQTT_HOST=mosquitto \
    MQTT_PORT=1883

CMD ["python", "publisher.py"]
