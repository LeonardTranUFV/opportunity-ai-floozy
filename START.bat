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

title Opportunity AI - dev server

echo.
echo   Opportunity AI
echo   ----------------------------------------
echo   Folder : %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js isn't installed, or isn't on your PATH.
  echo       Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
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
start "" /b cmd /c "timeout /t 5 /nobreak >nul & start "" http://localhost:3000"

echo   Starting on http://localhost:3000
echo   Close this window (or press Ctrl+C) to stop the server.
echo.

call npm run dev

REM Only reached if the server exits or crashes - keep the window open so the
REM error is actually readable instead of vanishing.
echo.
echo   Server stopped.
pause
