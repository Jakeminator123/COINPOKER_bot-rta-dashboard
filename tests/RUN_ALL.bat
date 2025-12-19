@echo off
title CoinPoker Master Security Test
color 0C

echo.
echo ============================================================
echo   COINPOKER MASTER SECURITY TEST
echo   All-in-one: Explorer + Recon + MITM
echo ============================================================
echo.

:: Check admin
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [ADMIN] Running with administrator privileges
    color 0A
) else (
    echo [WARN] NOT admin - some features limited
    echo        Right-click ^> Run as administrator
    echo.
)

:: Check CoinPoker
tasklist /FI "IMAGENAME eq game.exe" 2>NUL | find /I /N "game.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [OK] CoinPoker is running
) else (
    echo [!!] CoinPoker NOT running - start it first for full test
)

echo.
echo ============================================================
echo   VALJ VAD DU VILL GORA:
echo ============================================================
echo.
echo   1. EXPLORER       - Testa URLs, oppna webbsidor, skapa HTML-rapport
echo   2. FULL RECON     - Aggressiv recon (UI, Network, API, Memory)
echo   3. ULTIMATE       - Allt + Frida SSL hooking
echo   4. MITM PROXY     - Starta MITM proxy for trafikfangst
echo   5. FINGERPRINT    - Testa fingerprint spoofing
echo   6. ALLT I ORDNING - Kor 1, 2, 4 i sekvens
echo.
echo   0. EXIT
echo.

set /p choice="Valj [0-6]: "

if "%choice%"=="1" goto EXPLORER
if "%choice%"=="2" goto FULLRECON
if "%choice%"=="3" goto ULTIMATE
if "%choice%"=="4" goto MITM
if "%choice%"=="5" goto FINGERPRINT
if "%choice%"=="6" goto ALLSEQUENCE
if "%choice%"=="0" goto END

echo Ogiltigt val!
pause
goto END

:EXPLORER
echo.
echo ============================================================
echo   EXPLORER - Testar alla endpoints
echo ============================================================
cd /d "%~dp0"
python test_explore_coinpoker.py
goto MENU_AGAIN

:FULLRECON
echo.
echo ============================================================
echo   FULL RECON - Aggressiv reconnaissance
echo ============================================================
cd /d "%~dp0"
python test_full_recon.py
goto MENU_AGAIN

:ULTIMATE
echo.
echo ============================================================
echo   ULTIMATE RECON - Med Frida SSL hooking
echo ============================================================
cd /d "%~dp0"
python test_ultimate_recon.py
goto MENU_AGAIN

:MITM
echo.
echo ============================================================
echo   MITM PROXY - Aktiverar systemproxy och STARTAR MITM
echo ============================================================
echo.
echo [!] Detta aktiverar Windows systemproxy pa localhost:8080
echo [!] Se till att mitmproxy-certifikatet ar installerat!
echo [!] Proxyn STARTAR automatiskt och fangar ALL trafik
echo.
set /p confirm="Fortsatt? [y/N]: "
if /i not "%confirm%"=="y" goto MENU_AGAIN

echo.
echo [*] Aktiverar Windows proxy...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /t REG_SZ /d "localhost:8080" /f

echo.
echo [*] Proxy aktiverad!
echo.
echo ============================================================
echo   STARTAR MITMPROXY MED DIN ADDON
echo   Tryck Ctrl+C for att avsluta proxyn
echo   Loggar sparas i: test\proxygrejjer\mitm_logs\
echo ============================================================
echo.

:: Change to proxy folder and run
cd /d "%~dp0harsh_tests\proxygrejjer"
echo [*] Startar mitmdump med mitm_proxy.py addon...
echo.
mitmdump -s mitm_proxy.py --set ssl_insecure=true

:: When mitmdump exits (Ctrl+C), disable proxy
echo.
echo [*] Stangar Windows proxy...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f
echo [OK] Proxy stangd!
echo [OK] Loggar finns i: test\proxygrejjer\mitm_logs\
cd /d "%~dp0"
goto MENU_AGAIN

:FINGERPRINT
echo.
echo ============================================================
echo   FINGERPRINT SPOOFING TEST
echo ============================================================
echo.
set /p fakename="Ange fake namn (default=Martina): "
if "%fakename%"=="" set fakename=Martina

echo.
echo [*] Skickar fake fingerprint: %fakename%
python -c "import requests; r = requests.post('https://api.coinpokerbackend.com/init/health/update', json={'nick':'TestBot','os_login_name':'%fakename%','mac_addresses':'DE:AD:BE:EF:00:00','router_mac_address':'BA:AD:F0:0D:00:00','volume_id':'FAKE123'}); print(f'Response: {r.status_code}'); print('SERVER ACCEPTED FAKE DATA!' if r.status_code in [200,204] else f'Response: {r.text[:200]}')"
goto MENU_AGAIN

:ALLSEQUENCE
echo.
echo ============================================================
echo   KOR ALLT I SEKVENS
echo ============================================================
echo.
echo [1/3] Explorer...
python test_explore_coinpoker.py

echo.
echo [2/3] Full Recon...
python test_full_recon.py

echo.
echo [3/3] MITM Proxy
set /p wantmitm="Vill du starta MITM proxy nu? [y/N]: "
if /i "%wantmitm%"=="y" (
    echo.
    echo [*] Aktiverar Windows proxy...
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /t REG_SZ /d "localhost:8080" /f
    echo [*] Startar mitmproxy - Tryck Ctrl+C for att avsluta
    cd /d "%~dp0harsh_tests\proxygrejjer"
    mitmdump -s mitm_proxy.py --set ssl_insecure=true
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f
    echo [OK] Proxy stangd!
    cd /d "%~dp0"
)
goto MENU_AGAIN

:MENU_AGAIN
echo.
echo ============================================================
set /p again="Vill du gora nagot mer? [y/N]: "
if /i "%again%"=="y" goto :EOF
goto END

:END
echo.
echo ============================================================
echo   RESULTAT SPARADE I:
echo   - tests\explorer_output\
echo   - tests\recon_output\
echo   - tests\ultimate_recon\
echo ============================================================
echo.

:: Make sure proxy is disabled
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f >nul 2>&1

pause

