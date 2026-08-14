@echo off
REM ---------------------------------------------------------------
REM  Pearl River - one-time local database setup.
REM
REM  Copy this and setup-local-db.mjs into the Pearl River project
REM  folder (next to package.json) and double-click this file.
REM
REM  Run it once. After that, START-PEARL-RIVER.bat is all you need.
REM ---------------------------------------------------------------

chcp 65001 >nul
cd /d "%~dp0"

title Pearl River - local database setup

echo.
echo   Pearl River - local database setup
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

if not exist "setup-local-db.mjs" (
  echo   [X] setup-local-db.mjs isn't next to this file.
  echo       Both files have to be copied into the project folder.
  echo.
  pause
  exit /b 1
)

node setup-local-db.mjs
set CODE=%ERRORLEVEL%

echo.
if not "%CODE%"=="0" (
  echo   Setup did not finish. Read the message above.
) else (
  echo   Setup finished.
)
echo.
pause
exit /b %CODE%
