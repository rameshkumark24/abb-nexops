Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Starting NexOps Refinery Platform..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Start the Backend (FastAPI) in a new window
Write-Host "Launching Backend (FastAPI)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\nexops-backend'; ..\.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8000"

# 2. Start the Telemetry Publisher (Python) in a new window
Write-Host "Launching Telemetry Publisher (Python)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\nexops-data-generator'; `$env:PUBLISHER='mqtt'; ..\.venv\Scripts\python.exe publisher.py"

# 3. Start the Frontend (Next.js) in a new window
Write-Host "Launching Frontend (Next.js)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\abb-prototype-main'; npm run dev"

Write-Host "------------------------------------------" -ForegroundColor Green
Write-Host "All services launched in separate windows!" -ForegroundColor Green
Write-Host "------------------------------------------" -ForegroundColor Green
