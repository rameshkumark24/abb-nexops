# start-subscriber.ps1
# Runs the test consumer that subscribes to the broker and prints every
# telemetry record it receives. Use this to verify the feed is flowing.

$ErrorActionPreference = "Stop"
Write-Host "Starting test subscriber (CTRL+C to stop)..."
python subscriber_test.py
