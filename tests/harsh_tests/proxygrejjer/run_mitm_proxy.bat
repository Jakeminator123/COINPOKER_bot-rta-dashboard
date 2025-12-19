@echo off
REM Run MITM Proxy for CoinPoker traffic capture
echo ====================================
echo  COINPOKER MITM PROXY LAUNCHER
echo ====================================
echo.
echo This will start the MITM proxy on localhost:8080
echo.
echo IMPORTANT SETUP STEPS:
echo 1. Install certificate: Visit http://mitm.it in browser
echo 2. Configure Windows proxy: Settings ^> Network ^> Proxy
echo    - Manual proxy: localhost:8080
echo 3. Start CoinPoker and play
echo.
echo Press Ctrl+C to stop capturing
echo ====================================
echo.

cd /d "%~dp0"
python mitm_proxy.py

echo.
echo ====================================
echo  MITM Proxy stopped
echo ====================================
echo.
echo Check logs in: mitm_logs\
pause
