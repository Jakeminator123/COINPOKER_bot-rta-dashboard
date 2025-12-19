@echo off
REM test_other_sites.bat
REM Tests if other poker sites have certificate pinning

cd /d "%~dp0"

set PYTHON_EXE=C:\Program Files\Python313\python.exe

if not exist "%PYTHON_EXE%" (
    echo ERROR: Python not found
    pause
    exit /b 1
)

"%PYTHON_EXE%" test_other_sites.py

