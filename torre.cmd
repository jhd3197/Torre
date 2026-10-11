@echo off
rem The command line: python -m torre (torre/cli.py). Paths you pass stay relative to where you are.
setlocal
set "PYTHONPATH=%~dp0;%PYTHONPATH%"
if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" -m torre %*
) else (
    python -m torre %*
)
exit /b %errorlevel%
