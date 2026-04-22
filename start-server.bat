@echo off
REM Double-click to start the SVG_Conf local server.
REM The window stays open; close it (or Ctrl+C) to stop the server.
cd /d "%~dp0"
title SVG_Conf server (localhost:5100)
echo.
echo   Presentation: http://localhost:5100/
echo   Studio:       http://localhost:5100/studio.html
echo   Blackroom:    http://localhost:5100/blackroom/
echo.
echo   Close this window (or Ctrl+C) to stop the server.
echo.
node server.js .\gallery
pause
