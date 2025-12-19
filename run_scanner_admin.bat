@echo off
REM Launch scanner.py with administrator privileges.
REM Uses PowerShell to prompt for elevation, then runs python with the scanner path.

setlocal
set "SCRIPT=%~dp0scanner.py"
set "WORKDIR=%~dp0"

REM If you prefer a specific interpreter, set PYTHON_EXE before calling this file.
if not defined PYTHON_EXE set "PYTHON_EXE=python"

REM Use PowerShell with proper argument escaping for paths with spaces
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath '%PYTHON_EXE%' -WorkingDirectory '%WORKDIR%' -ArgumentList '%SCRIPT%' -Verb RunAs"

endlocal

