@echo off
echo ==========================================
echo Starting NexOps Refinery Platform...
echo ==========================================

:: 1. Start the Backend (FastAPI) in a new window
echo Launching Backend (FastAPI)...
start "NexOps Backend" cmd /k "cd /d c:\nexops\nexops-backend && uvicorn main:app --host 0.0.0.0 --port 8000"

:: 2. Start the Telemetry Publisher (Python) in a new window
echo Launching Telemetry Publisher (Python)...
start "NexOps Telemetry Publisher" cmd /k "cd /d c:\nexops\nexops-data-generator && set PUBLISHER=mqtt&& python publisher.py"

:: 3. Start the Frontend (Next.js) in a new window
echo Launching Frontend (Next.js)...
start "NexOps Frontend" cmd /k "cd /d c:\nexops\abb-prototype-main && npm run dev"

echo ------------------------------------------
echo All services launched in separate windows!
echo ------------------------------------------
pause
