# start-broker.ps1
# Starts the Mosquitto MQTT broker in Docker as a named container.
# Safe to run repeatedly: if the container already exists it is (re)started
# instead of erroring out.

$ErrorActionPreference = "Stop"
$Name = "nexops-broker"

# Does a container with this name already exist (running or stopped)?
$existing = docker ps -a --filter "name=^/$Name$" --format "{{.Names}}"

if ($existing -eq $Name) {
    Write-Host "Container '$Name' already exists - starting it..."
    docker start $Name | Out-Null
} else {
    Write-Host "Creating and starting broker container '$Name'..."
    docker run -d --name $Name -p 1883:1883 eclipse-mosquitto | Out-Null
}

Write-Host ""
Write-Host "Broker running on localhost:1883" -ForegroundColor Green
Write-Host "(Leave this window open. Use stop-broker.ps1 to shut it down.)"
