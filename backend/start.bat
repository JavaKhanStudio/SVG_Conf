@echo off
REM Start the SVG Workshop backend.
REM Usage: backend\start.bat
cd /d "%~dp0"
python -m uvicorn main:app --host 127.0.0.1 --port 5174 --reload
