@echo off
cd /d "%~dp0"

:MENU
cls
echo.
echo ========================================
echo   COINPOKER INFORMATION FINDER
echo ========================================
echo.
echo [1] Find Nickname Only
echo [2] Capture ALL Traffic  
echo [3] Exit
echo.
set /p choice="Choose (1/2/3): "

if "%choice%"=="1" goto NICKNAME
if "%choice%"=="2" goto ALLTRAFFIC
if "%choice%"=="3" goto EXIT
goto MENU

:NICKNAME
cls
echo.
echo Starting Nickname Finder...
echo.
call :SETUP
if errorlevel 1 goto MENU
python "%~dp0find_nickname.py"
call :CLEANUP
pause
goto MENU

:ALLTRAFFIC
cls
echo.
echo Starting Full Traffic Capture...
echo.
call :SETUP
if errorlevel 1 goto MENU
python "%~dp0getalltraffic.py"
call :CLEANUP
pause
goto MENU

:SETUP
REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found!
    exit /b 1
)

REM Install mitmproxy if needed
python -c "import mitmproxy" >nul 2>&1
if errorlevel 1 (
    echo Installing mitmproxy...
    pip install mitmproxy
    if errorlevel 1 (
        echo [ERROR] Failed to install mitmproxy
        exit /b 1
    )
)

REM Enable proxy
echo [OK] Enabling proxy...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /t REG_SZ /d "localhost:8080" /f >nul 2>&1

echo.
echo First time? Visit http://mitm.it to install certificate
echo.
echo Press any key when ready...
pause >nul
exit /b 0

:CLEANUP
echo.
echo Disabling proxy...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f >nul 2>&1
echo [OK] Done
exit /b 0

:EXIT
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f >nul 2>&1
exit /b 0
