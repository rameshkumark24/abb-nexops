# start-publisher.ps1
# Runs the publisher in MQTT mode: it pulls records from the simulator and
# publishes them to the broker on per-machine topics.

$ErrorActionPreference = "Stop"
$env:PUBLISHER = "mqtt"
Write-Host "Starting publisher in MQTT mode (CTRL+C to stop)..."
python publisher.py
