@echo off
cd /d "%~dp0.."
echo ==================================================== >> auto-scrape.log
echo %date% %time% >> auto-scrape.log
call npm run auto-scrape >> auto-scrape.log 2>&1
