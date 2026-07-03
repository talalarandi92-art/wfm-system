@echo off
title WFM System - Stop
echo Stopping WFM services...

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":3000 .*LISTENING"') do (
    echo Killing backend PID %%p
    taskkill /PID %%p /F >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":5173 .*LISTENING"') do (
    echo Killing frontend PID %%p
    taskkill /PID %%p /F >nul 2>&1
)
echo Done.
timeout /t 3 >nul
