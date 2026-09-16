@echo off
REM ---------------------------------------------------------------
REM  Opportunity AI - sign an account in on THIS PC
REM
REM  For accounts collected locally by RUN-WORKER.bat. Opens a visible
REM  Chrome on the profile the worker crawls with: log in, finish any
REM  2FA, then close the window to save.
REM
REM    LOCAL-LOGIN.bat facebook
REM    LOCAL-LOGIN.bat nextdoor
REM
REM  If the account already has that platform connected through the
REM  website, press Disconnect there first - the worker uses a stored
REM  website login before a local one. The script warns you if so.
REM ---------------------------------------------------------------

chcp 65001 >nul
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo.
  echo   Which platform?  e.g.  LOCAL-LOGIN.bat facebook
  echo.
  pause
  exit /b 1
)

if not exist ".env.worker" (
  echo   [X] .env.worker not found - see RUN-WORKER.bat.
  pause
  exit /b 1
)

npx tsx scripts/local-login.ts --env .env.worker --platform %~1
pause
