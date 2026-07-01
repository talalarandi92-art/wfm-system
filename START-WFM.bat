@echo off
title WFM System Launcher
cd /d "%~dp0"
color 0B
echo ==================================================
echo    Boutiqaat WFM System  -  starting up...
echo ==================================================
echo.

echo [1/2] Backend  (port 3000)...
start "WFM Backend :3000" cmd /k "cd /d "%~dp0backend" && (if not exist dist\main.js npm run build) && node dist\main"

echo [2/2] Frontend (port 5173)...
start "WFM Frontend :5173" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo Waiting for the servers to boot...
timeout /t 9 /nobreak >nul

echo Opening the app in your browser...
start "" http://localhost:5173

echo.
echo ==================================================
echo    WFM is UP
echo    Frontend : http://localhost:5173   (login as admin)
echo    Backend  : http://localhost:3000
echo.
echo    To STOP: close the two opened windows,
echo             or run STOP-WFM.bat
echo ==================================================
echo.
echo This window can be closed. The two server windows keep running.
pause
