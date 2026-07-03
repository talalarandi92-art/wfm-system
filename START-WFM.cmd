@echo off
title WFM System Launcher
setlocal EnableDelayedExpansion
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ==========================================
echo    WFM System - One-Click Start
echo ==========================================

rem ---- Backend (port 3000) ----
netstat -ano | findstr /r ":3000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [OK] Backend already running on port 3000
) else (
    echo [..] Starting backend...
    start "WFM Backend" /min cmd /c "cd /d "%ROOT%backend" && node dist\main"
)

rem ---- Frontend (port 5173) ----
netstat -ano | findstr /r ":5173 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [OK] Frontend already running on port 5173
) else (
    echo [..] Starting frontend...
    start "WFM Frontend" /min cmd /c "cd /d "%ROOT%frontend" && npm run dev"
)

rem ---- Wait for backend health ----
echo [..] Waiting for services...
set /a tries=0
:waitloop
set /a tries+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/v1/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto ready
if %tries% geq 30 goto timeout
timeout /t 2 /nobreak >nul
goto waitloop

:ready
echo [OK] Backend is healthy
echo [OK] Opening the system in your browser...
start "" "http://localhost:5173"
echo.
echo ==========================================
echo    WFM System is UP - you can close this
echo ==========================================
timeout /t 5 >nul
exit /b 0

:timeout
echo [!!] Backend did not respond within 60s.
echo      Check the "WFM Backend" window for errors.
pause
exit /b 1
