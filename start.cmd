@echo off
rem Starts Aether on http://127.0.0.1:8020. The first start installs everything (needs internet).
cd /d "%~dp0"

if not exist backend\.venv (
  echo Installing Python packages ...
  python -m venv backend\.venv || goto :error
  backend\.venv\Scripts\python -m pip install -q -r backend\requirements.txt || goto :error
)

pushd frontend
if not exist node_modules (
  echo Installing website packages ...
  call npm install --no-audit --no-fund || goto :error
)
echo Building the website ...
call npm run build >nul || goto :error
popd

echo.
echo   Aether is running: http://127.0.0.1:8020
echo   Use Edge or Chrome (voice commands need one of them).
echo   Close this window to stop.
echo.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:8020'"
backend\.venv\Scripts\python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8020 --no-access-log
pause
goto :eof

:error
echo Something went wrong. Please read the message above.
pause
