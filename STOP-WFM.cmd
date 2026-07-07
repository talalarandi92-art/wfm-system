@echo off
title WFM System - Stop
echo Stopping WFM server...

rem Single-origin: the backend on port 3000 serves the UI too. Port 5173 is
rem swept as well in case an old Vite dev server is lingering from a prior version.
rem PowerShell Get-NetTCPConnection is used because the old netstat|findstr check
rem split on the space and matched the wrong lines.
powershell -NoProfile -Command "foreach ($port in 3000,5173) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('Killing PID ' + $_.OwningProcess + ' on port ' + $port); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

echo Done.
ping -n 3 127.0.0.1 >nul
