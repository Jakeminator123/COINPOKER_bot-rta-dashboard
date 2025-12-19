@echo off
REM disable_windows_proxy.bat
REM Disables Windows proxy configuration

echo.
echo ============================================================
echo DISABLING WINDOWS PROXY
echo ============================================================
echo.

reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f

echo.
echo Proxy disabled successfully!
echo You can now use the internet normally.
echo.
pause

