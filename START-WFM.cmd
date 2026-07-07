@echo off
title WFM System Launcher
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

rem ---- Fix the 8.3 short TEMP path (username has a dot -> C:\Users\T573E~1.BAS) ----
rem     The short path silently breaks npm/node child builds; force the long form.
if exist "%USERPROFILE%\AppData\Local\Temp" (
    set "TEMP=%USERPROFILE%\AppData\Local\Temp"
    set "TMP=%USERPROFILE%\AppData\Local\Temp"
)

echo ==========================================
echo    WFM System - One-Click Start
echo ==========================================

rem ---- Ensure the frontend is built (single-origin: the backend serves it) ----
if not exist "%ROOT%frontend\dist\index.html" (
    echo [..] Building the UI once ^(first run only^)...
    pushd "%ROOT%frontend"
    call npm run build
    popd
    if not exist "%ROOT%frontend\dist\index.html" (
        echo [!!] Frontend build failed. Check the errors above.
        pause
        exit /b 1
    )
)

rem ---- Is the WFM server already up on 3000?  (unambiguous PowerShell check;
rem      the old "netstat | findstr :3000 .*LISTENING" was broken - findstr splits
rem      on the space and matched EVERY LISTENING line, so it never started up.) ----
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
    echo [OK] WFM already running on port 3000
) else (
    echo [..] Starting WFM ^(backend + UI on one port^)...
    rem  node is launched detached via PowerShell Start-Process - reliable across
    rem  double-click / shortcut / scheduled contexts; its output is logged.
    powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'dist\main.js' -WorkingDirectory '%ROOT%backend' -WindowStyle Minimized -RedirectStandardOutput '%ROOT%backend\.wfm-server.log' -RedirectStandardError '%ROOT%backend\.wfm-server.err.log'"
)

rem ---- Wait for the server to become healthy (ping = stdin-safe sleep) ----
echo [..] Waiting for the server to come up...
set /a tries=0
:waitloop
set /a tries+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest 'http://localhost:3000/api/v1/health' -UseBasicParsing -TimeoutSec 2; exit ([int]($r.StatusCode -ne 200)) } catch { exit 1 }"
if %errorlevel%==0 goto ready
if %tries% geq 40 goto timeout
ping -n 3 127.0.0.1 >nul
goto waitloop

:ready
echo [OK] Server is healthy - opening the system in your browser...
start "" "http://localhost:3000"
echo.
echo ==========================================
echo    WFM System is UP - http://localhost:3000
echo    You can close this window.
echo ==========================================
ping -n 4 127.0.0.1 >nul
exit /b 0

:timeout
echo [!!] Server did not respond in time.
echo      See backend\.wfm-server.err.log for the error.
pause
exit /b 1
