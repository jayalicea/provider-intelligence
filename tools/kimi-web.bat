@echo off
REM kimi-web.bat: launch the Kimi Code Web UI for provider-intelligence from the taskbar.
REM If the server is already running, this just opens the browser.

set "URL=http://127.0.0.1:58627/#token=TJiS5O4zeuq2B0yNs1N62D1hpZ3ZTmpLoHSD5wKA094"
set "PROJECT=C:\Users\casalab\provider-intelligence"

netstat -ano | findstr ":58627" | findstr LISTENING >nul
if %errorlevel%==0 (
    start "" "%URL%"
    exit /b
)

start "Kimi Web Server" /min cmd /k "cd /d %PROJECT% && kimi web"
timeout /t 6 /nobreak >nul
start "" "%URL%"
