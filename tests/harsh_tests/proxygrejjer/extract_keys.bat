@echo off
REM extract_keys.bat
REM Extracts SSL/TLS certificates and keys from mitmproxy

cd /d "%~dp0"

set PYTHON_EXE=C:\Program Files\Python313\python.exe

if not exist "%PYTHON_EXE%" (
    echo ERROR: Python not found
    pause
    exit /b 1
)

echo.
echo ============================================================
echo SSL/TLS KEY EXTRACTOR
echo ============================================================
echo.
echo This will copy all mitmproxy certificates and keys to:
echo   %CD%\ssl_keys\
echo.
pause

"%PYTHON_EXE%" extract_keys.py

