@echo off
REM Start monitoring script with watch mode
REM Double-click this file to start continuous monitoring

cd /d "%~dp0\.."
python scripts\monitor_load.py --watch --interval 60

pause

