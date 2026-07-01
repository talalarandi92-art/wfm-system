@echo off
title WFM System - Stop
color 0C
echo Stopping WFM System (ports 3000 + 5173)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
echo Done. WFM stopped.
timeout /t 2 /nobreak >nul
