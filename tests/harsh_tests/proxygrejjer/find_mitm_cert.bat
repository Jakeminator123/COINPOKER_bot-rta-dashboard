@echo off
REM find_mitm_cert.bat
REM Opens the folder where mitmproxy stores certificates

echo.
echo ============================================================
echo FINDING MITMPROXY CERTIFICATE
echo ============================================================
echo.

set CERT_DIR=%USERPROFILE%\.mitmproxy

if exist "%CERT_DIR%" (
    echo Certificate folder found at:
    echo %CERT_DIR%
    echo.
    echo Opening folder...
    explorer "%CERT_DIR%"
    echo.
    echo Look for: mitmproxy-ca-cert.p12
    echo Double-click to install it!
    echo.
) else (
    echo Certificate folder not found!
    echo Run mitm_proxy.py first to generate certificates.
    echo.
)

pause

