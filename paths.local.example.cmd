@echo off
REM ---------------------------------------------------------------
REM  Where Pearl River and VDN live on THIS machine.
REM
REM  START-ALL.bat looks for both projects next to this one first. If
REM  yours are somewhere else - another drive, a different folder name -
REM  copy this file to paths.local.cmd, fill in the real paths, and
REM  START-ALL.bat will use them instead of guessing.
REM
REM  paths.local.cmd is gitignored on purpose: it describes your
REM  machine, not the project, and everyone's is different.
REM ---------------------------------------------------------------

set "PEARL_RIVER_DIR=C:\Users\you\Documents\pearl-river-hotel-system"
set "VDN_DIR=C:\Users\you\Documents\vdn-logistics-system"
