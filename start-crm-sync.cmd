@echo off
setlocal
cd /d "%~dp0"
set CRM_REMOTE_ORIGIN=https://sp-sales-crm.piaoenya.workers.dev
set CRM_LOCAL_PORT=14327
node tools/start-crm.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
start "" chrome "http://127.0.0.1:14327/"
endlocal
