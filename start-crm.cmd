@echo off
cd /d "%~dp0"
node tools/start-crm.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
start "" chrome "http://127.0.0.1:4327/"
