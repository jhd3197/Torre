@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File dev.ps1 serve -Open
pause
