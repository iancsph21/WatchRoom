@echo off
cd /d "%~dp0"
call npm.cmd ci
if errorlevel 1 goto failed
call npm.cmd run build
if errorlevel 1 goto failed
set DEMO_MODE=true
set HOST=127.0.0.1
set PORT=3000
echo Open http://localhost:3000 in your browser.
node server.js
exit /b 0
:failed
echo Install Node.js 22.16 or newer, then try again.
pause
