@echo off
REM setup_windows_proxy.bat
REM Configures Windows to use the MITM proxy

echo.
echo ============================================================
echo WINDOWS PROXY CONFIGURATION
echo ============================================================
echo.
echo This will configure Windows to route traffic through the
echo MITM proxy at localhost:8080
echo.
echo IMPORTANT: Make sure mitm_proxy.py is running first!
echo.
pause

echo.
echo Enabling proxy...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /t REG_SZ /d "localhost:8080" /f

echo.
echo ============================================================
echo PROXY ENABLED
echo ============================================================
echo.
echo Proxy is now active: localhost:8080
echo.
echo NEXT STEPS:
echo 1. Visit http://mitm.it in your browser
echo 2. Download and install the mitmproxy certificate
echo 3. Start CoinPoker
echo 4. All HTTPS traffic will be decrypted!
echo.
echo To disable proxy later, run: disable_windows_proxy.bat
echo ============================================================
echo.
pause

