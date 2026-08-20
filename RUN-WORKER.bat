@echo off
REM ---------------------------------------------------------------
REM  Opportunity AI - crawler worker
REM
REM  Vercel serves the site and scores posts, but it cannot crawl
REM  Facebook, LinkedIn, Nextdoor or X: those are read through a
REM  signed-in Chrome profile on a real machine, and a serverless
REM  function has no screen, no browser and no disk that survives the
REM  request. This script is the half that runs here instead.
REM
REM  It scrapes every connected customer's sources with the Chrome
REM  profiles stored on this PC and writes the posts straight into the
REM  production database. The hosted cron
REM  (/api/cron/auto-scan, hourly) then scores whatever it finds - it
REM  never scrapes. So: this machine collects, Vercel judges.
REM
REM  Run it on a timer. Task Scheduler, every 4 hours:
REM
REM    Program/script :  cmd.exe
REM    Arguments      :  /c "<full path>\RUN-WORKER.bat" /quiet
REM    Start in       :  <full path to this folder>
REM
REM  /quiet skips the pause at the end so a scheduled run closes on
REM  its own. Double-click it without /quiet to watch a run happen.
REM ---------------------------------------------------------------

chcp 65001 >nul
setlocal
cd /d "%~dp0"

title Opportunity AI - crawler worker

if not exist ".env.worker" (
  echo.
  echo   [X] .env.worker not found.
  echo.
  echo       This file holds the PRODUCTION Supabase credentials, which
  echo       is what makes the crawl land in the live site's database
  echo       instead of your local one. Copy .env.worker.example to
  echo       .env.worker and fill it in.
  echo.
  if /i not "%~1"=="/quiet" pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js isn't installed, or isn't on your PATH.
  if /i not "%~1"=="/quiet" pause
  exit /b 1
)

if not exist "node_modules" (
  echo   Installing dependencies for the first time - this takes a few minutes...
  call npm install
  if errorlevel 1 (
    echo   [X] npm install failed. Read the error above.
    if /i not "%~1"=="/quiet" pause
    exit /b 1
  )
)

if not exist "logs" mkdir "logs"

echo.
echo   Crawling for every connected account, into the production database.
echo   Sources whose owner has no session on this PC are skipped by name.
echo.

REM A scheduled run leaves no window to read, so keep a log. Tee rather
REM than plain redirect, so a run started by hand still shows progress
REM live instead of going silent for several minutes. No "call" here:
REM inside a pipeline cmd already spawns npx in its own shell, and call
REM would only confuse the exit code.
REM Redirection first, so the dashes can't run into the ">>".
>>"logs\worker.log" echo ---- %date% %time% ----
npx tsx scripts/auto-scrape.ts --env .env.worker 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath 'logs\worker.log' -Append"

echo.
echo   Finished. Full output appended to logs\worker.log
echo.
if /i not "%~1"=="/quiet" pause
exit /b 0
