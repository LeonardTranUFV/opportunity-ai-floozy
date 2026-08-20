@echo off
REM ---------------------------------------------------------------
REM  Start all three systems at once.
REM
REM  Double-click this file. Each app gets its own console window and
REM  its own browser tab. Closing a console window stops that app and
REM  leaves the other two running.
REM
REM    3000  Pearl River hotel system
REM    3001  Opportunity AI          <- this folder
REM    3100  VDN Logistics
REM
REM  The ports are pinned with -p. All three are Next.js apps whose
REM  "dev" script names no port, so Next takes 3000 if it is free and
REM  silently steps to the next free one if it is not. Started together
REM  and unpinned, whichever app loses the race lands on a port nobody
REM  opened, and you get shown the wrong system. START.bat already
REM  learned this the hard way for Opportunity AI; this does it for all
REM  three.
REM ---------------------------------------------------------------

REM UTF-8 so the accented folder name (May tinh) doesn't mangle paths.
chcp 65001 >nul

setlocal enabledelayedexpansion
cd /d "%~dp0"

title Start all - Pearl River / Opportunity AI / VDN

echo.
echo   Starting Pearl River, Opportunity AI and VDN Logistics
echo   ------------------------------------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] Node.js isn't installed, or isn't on your PATH.
  echo       Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

REM Opportunity AI is the folder this file sits in. The other two live
REM elsewhere on disk, so we have to go find them.
set "OPPORTUNITY_DIR=%CD%"
set "PEARL_RIVER_DIR="
set "VDN_DIR="
set "OPEN_PORTS="

REM If the folders aren't where the guesses below look, write the two
REM paths into paths.local.cmd next to this file and they win. Copy
REM paths.local.example.cmd to start from. It is gitignored - it
REM describes your machine, not the project.
if exist "paths.local.cmd" call "paths.local.cmd"

REM Otherwise look next to this project, under the names the repos use
REM and the ones a clone tends to get renamed to.
for %%P in ("%~dp0..") do set "SIBLINGS=%%~fP"
call :find PEARL_RIVER_DIR "pearl-river-hotel-system"
call :find PEARL_RIVER_DIR "Pearl River Hotel System"
call :find PEARL_RIVER_DIR "pearl-river"
call :find PEARL_RIVER_DIR "Pearl River"
call :find VDN_DIR "vdn-logistics-system"
call :find VDN_DIR "VDN Logistics System"
call :find VDN_DIR "vdn-logistics"
call :find VDN_DIR "VDN"

REM Pearl River first: it owns 3000, the port Next reaches for by
REM default, so let it take the one it wants before the others start.
call :launch "Pearl River hotel system" "%PEARL_RIVER_DIR%" 3000
call :launch "Opportunity AI"           "%OPPORTUNITY_DIR%" 3001
call :launch "VDN Logistics"            "%VDN_DIR%"         3100

REM Servers need a moment to bind before a tab is worth opening. One
REM wait for all of them, rather than three overlapping ones.
if defined OPEN_PORTS (
  echo.
  echo   Waiting for the servers to come up...
  timeout /t 10 /nobreak >nul
  for %%Q in (!OPEN_PORTS!) do start "" http://localhost:%%Q
)

echo.
echo   Done. Each app has its own window - close it to stop that app.
echo.
pause
exit /b 0

REM ---------------------------------------------------------------
REM  :find  <variable-name> <folder-name>
REM  Sets the variable to a sibling folder of this project, if that
REM  folder exists and looks like a Node project. First hit wins, so
REM  later calls for an already-found app are no-ops.
REM ---------------------------------------------------------------
:find
if defined %~1 goto :eof
if not exist "%SIBLINGS%\%~2\package.json" goto :eof
for %%I in ("%SIBLINGS%\%~2") do set "%~1=%%~fI"
goto :eof

REM ---------------------------------------------------------------
REM  :launch  <display-name> <folder> <port>
REM  Starts one app, unless it is already up or we couldn't find it.
REM  A missing app is reported and skipped - one absent folder should
REM  not stop the other two from starting.
REM ---------------------------------------------------------------
:launch
set "_name=%~1"
set "_dir=%~2"
set "_port=%~3"

echo.
echo   %_name%  -  port %_port%

if not defined _dir (
  echo     [ ] folder not found next to this project - skipped.
  echo         Set its path in paths.local.cmd to start it from here.
  goto :eof
)
if not exist "%_dir%\package.json" (
  echo     [X] no package.json in %_dir% - skipped.
  goto :eof
)

REM Already running? Then just open it. Starting a second copy would
REM only fail on the port, or wander onto another one.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":%_port% " >nul
if not errorlevel 1 (
  echo     already running - opening the browser.
  start "" http://localhost:%_port%
  goto :eof
)

REM First run after a fresh clone won't have dependencies yet.
if not exist "%_dir%\node_modules" (
  echo     installing dependencies for the first time - this takes a few minutes...
  pushd "%_dir%"
  call npm install
  set "_rc=!errorlevel!"
  popd
  if not "!_rc!"=="0" (
    echo     [X] npm install failed in %_dir% - skipped.
    goto :eof
  )
)

echo     starting %_dir%
start "%_name% - port %_port%" /d "%_dir%" cmd /k "npx next dev -p %_port%"
set "OPEN_PORTS=!OPEN_PORTS! %_port%"
goto :eof
