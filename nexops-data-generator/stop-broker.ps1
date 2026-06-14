# stop-broker.ps1
# Stops and removes the nexops-broker container cleanly.

$ErrorActionPreference = "Stop"
$Name = "nexops-broker"

$existing = docker ps -a --filter "name=^/$Name$" --format "{{.Names}}"

if ($existing -eq $Name) {
    Write-Host "Stopping broker container '$Name'..."
    docker stop $Name | Out-Null
    Write-Host "Removing broker container '$Name'..."
    docker rm $Name | Out-Null
    Write-Host "Broker stopped and removed." -ForegroundColor Green
} else {
    Write-Host "No broker container '$Name' found - nothing to stop."
}
