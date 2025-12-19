@echo off
REM Automatic CoinPoker MITM Capture
REM Starts proxy when CoinPoker runs, stops when it closes

echo ====================================
echo  AUTOMATIC COINPOKER CAPTURE
echo ====================================
echo.
echo This will automatically:
echo   1. Wait for CoinPoker to start
echo   2. Capture all traffic while you play
echo   3. Stop when you close CoinPoker
echo   4. Repeat for next session
echo.
echo FIRST TIME SETUP:
echo   1. Visit http://mitm.it - install certificate
echo   2. Windows Settings ^> Network ^> Proxy
echo      - Enable manual proxy: localhost:8080
echo.
echo Just leave this running and play CoinPoker!
echo Press Ctrl+C to stop completely
echo ====================================
echo.

cd /d "%~dp0"
python auto_capture.py

pause

