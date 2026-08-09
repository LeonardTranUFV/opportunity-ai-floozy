@echo off
REM ---------------------------------------------------------------
REM  Opportunity AI - local dev server
REM  Double-click this file. It starts the app and opens the browser.
REM ---------------------------------------------------------------

REM UTF-8 so the accented folder name (May tinh) doesn't mangle paths.
chcp 65001 >nul

REM Work from this file's own folder, so the script keeps working even if
REM the project gets moved or renamed.
cd /d "%~dp0"

REM ---------------------------------------------------------------
REM  Opportunity AI owns port 3001. Pinned, not left to chance.
REM
REM  This used to run "npm run dev" with no port and then open :3000.
REM  Next.js takes 3000 if it is free and silently steps to 3001 if it
REM  is not - so with Pearl River already running on 3000, the server
REM  started on 3001 while the browser opened 3000, and you were shown
REM  the hotel system instead. Nothing was broken; it was two apps and
REM  one port.
REM
REM    3000  Pearl River hotel system
REM    3001  Opportunity AI   <- this one
REM    3100  VDN Logistics
REM ---------------------------------------------------------------
set PORT=3001

title Opportunity AI - dev server (port %PORT%)

echo.
echo   Opportunity AI
echo   ----------------------------------------
echo   Folder : %CD%
echo   Port   : %PORT%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js isn't installed, or isn't on your PATH.
  echo       Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

REM Already running? Then just open it. Starting a second copy would only
REM fail on the port, or wander onto another one and cause this all over.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":%PORT% " >nul
if not errorlevel 1 (
  echo   Already running - opening the browser.
  echo.
  start "" http://localhost:%PORT%
  echo   Close the OTHER window to stop the server.
  echo.
  pause
  exit /b 0
)

REM First run after a fresh clone won't have dependencies yet.
if not exist "node_modules" (
  echo   Installing dependencies for the first time - this takes a few minutes...
  call npm install
  if errorlevel 1 (
    echo.
    echo   [X] npm install failed. Read the error above.
    pause
    exit /b 1
  )
)

REM Open the browser shortly after, so the page loads once the server is up.
start "" /b cmd /c "timeout /t 5 /nobreak >nul & start "" http://localhost:%PORT%"

echo   Starting on http://localhost:%PORT%
echo   Close this window (or press Ctrl+C) to stop the server.
echo.

REM -p pins it. Without this Next.js picks its own port when 3001 is busy,
REM and the browser above would open the wrong app again.
call npx next dev -p %PORT%

REM Only reached if the server exits or crashes - keep the window open so the
REM error is actually readable instead of vanishing.
echo.
echo   Server stopped.
pause
