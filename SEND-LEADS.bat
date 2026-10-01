@echo off
REM ---------------------------------------------------------------
REM  Opportunity AI - morning lead email
REM
REM  Emails each contractor in lead-recipients.json a CSV of their new
REM  leads (score 60+, posted in the last 7 days or undated and seen in
REM  the last 3). Needs GMAIL_USER and GMAIL_APP_PASSWORD in .env.worker;
REM  TYPESAFE_API_KEY there is optional and lets Jev drop stale undated posts.
REM
REM  Task Scheduler, daily at 7:00 AM:
REM    Program/script :  cmd.exe
REM    Arguments      :  /c "<full path>\SEND-LEADS.bat" /quiet
REM    Start in       :  <full path to this folder>
REM
REM  Double-click without /quiet to watch a run. Add /dry to write the
REM  CSVs to exports\ without emailing anyone.
REM ---------------------------------------------------------------

chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs

set SENDFLAG=--send
if /i "%~1"=="/dry" set SENDFLAG=
if /i "%~2"=="/dry" set SENDFLAG=

echo [%date% %time%] send-daily-leads %SENDFLAG% >> logs\send-leads.log
call npx tsx scripts/send-daily-leads.ts --env .env.worker %SENDFLAG% >> logs\send-leads.log 2>&1

if /i not "%~1"=="/quiet" (
  powershell -NoProfile -Command "Get-Content logs\send-leads.log -Tail 20"
  pause
)
