@echo off
REM ---------------------------------------------------------------
REM  Pearl River hotel system - local dev server
REM
REM  Copy this file into the Pearl River project folder (next to its
REM  package.json), then double-click it. It works out its own folder,
REM  so it keeps working if the project is moved or renamed.
REM ---------------------------------------------------------------

REM UTF-8 so accented folder names (May tinh) don't mangle paths.
chcp 65001 >nul

cd /d "%~dp0"

REM ---------------------------------------------------------------
REM  Pearl River owns port 3000. Pinned, not left to chance.
REM
REM    3000  Pearl River hotel system   <- this one
REM    3001  Opportunity AI
REM    3100  VDN Logistics
REM
REM  Dev servers that pick their own port when the one they want is
REM  busy are how you end up opening one app and being shown another.
REM  Every app here gets one port and keeps it.
REM ---------------------------------------------------------------
set PORT=3000

title Pearl River - dev server (port %PORT%)

echo.
echo   Pearl River hotel system
echo   ----------------------------------------
echo   Folder : %CD%
echo   Port   : %PORT%
echo.

if not exist "package.json" (
  echo   [X] No package.json here, so this isn't the project folder.
  echo       Copy this file into the Pearl River folder and run it there.
  echo.
  pause
  exit /b 1
)

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

REM -p pins the port for Next.js. Anything else gets PORT= and its own dev
REM script - if that project ignores PORT, replace the else branch below
REM with its real command (e.g. "call npm run dev -- --port %PORT%").
findstr /c:"\"next\"" package.json >nul 2>nul
if not errorlevel 1 (
  call npx next dev -p %PORT%
) else (
  call npm run dev
)

REM Only reached if the server exits or crashes - keep the window open so the
REM error is actually readable instead of vanishing.
echo.
echo   Server stopped.
pause
