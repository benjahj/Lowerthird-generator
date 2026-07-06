@echo off
cd /d "%~dp0"
echo Starter LT Fabrik paa http://localhost:8617 ...
start "" "http://localhost:8617"
node server.js
pause
