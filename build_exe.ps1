# build_exe.ps1 - Build scanner.py to standalone .exe file
# PowerShell script for building CoinPoker Scanner executable

Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "  BUILDING COINPOKER SCANNER - STANDALONE EXE" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

# Check Python
Write-Host "[Build] Checking Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "[OK] $pythonVersion" -ForegroundColor Green
}
catch {
    Write-Host "[ERROR] Python not found" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check PyInstaller
Write-Host "[Build] Checking PyInstaller..." -ForegroundColor Yellow
try {
    python -c "import PyInstaller" 2>&1 | Out-Null
    Write-Host "[OK] PyInstaller is installed" -ForegroundColor Green
}
catch {
    Write-Host "[INFO] PyInstaller not installed. Installing..." -ForegroundColor Yellow
    pip install pyinstaller
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to install PyInstaller" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# Clean previous builds
Write-Host "[Build] Cleaning previous builds..." -ForegroundColor Yellow
if (Test-Path "build") {
    Remove-Item -Recurse -Force "build"
}
if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist"
}

Write-Host ""
Write-Host "[Build] Building standalone executable..." -ForegroundColor Yellow
Write-Host "[Build] This may take a few minutes..." -ForegroundColor Yellow
Write-Host ""

# Embed runtime config
Write-Host "[Build] Embedding runtime config snapshot..." -ForegroundColor Yellow
python tools/embed_runtime_config.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to embed runtime config" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Verify the embedded config contains the correct URL
$embeddedFile = "core/runtime_config_embedded.py"
if (Test-Path $embeddedFile) {
    $content = Get-Content $embeddedFile -Raw
    if ($content -match "DASHBOARD_URL=https://bot-rta-dashboard-2.onrender.com/api") {
        Write-Host "[Build] Verified: Embedded config has correct Render URL" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] Embedded config may not have correct URL!" -ForegroundColor Yellow
        Write-Host "[WARNING] Please check config.txt has DASHBOARD_URL set correctly" -ForegroundColor Yellow
    }
}

# Check if icon exists
$iconFile = "CoinPoker_cropped.ico"
if (Test-Path $iconFile) {
    Write-Host "[Build] Using icon: $iconFile" -ForegroundColor Green
}
else {
    Write-Host "[Build] No $iconFile found, building without icon" -ForegroundColor Yellow
}

# Build with PyInstaller
if (Test-Path "scanner.spec") {
    Write-Host "[Build] Using scanner.spec configuration..." -ForegroundColor Cyan
    pyinstaller --clean --noconfirm scanner.spec
}
else {
    Write-Host "[Build] Building with PyInstaller (no spec file found)..." -ForegroundColor Yellow
    $iconParam = if (Test-Path $iconFile) { "--icon=$iconFile" } else { "" }
    
    # Build PyInstaller command with all necessary modules and data files
    $hiddenImports = @(
        # Windows API modules
        "win32timezone", "win32api", "win32con", "win32gui", "win32process", "win32ui", "winreg",
        # Image processing
        "pytesseract", "PIL", "PIL.Image", "PIL.ImageEnhance", "PIL.ImageGrab",
        # Core dependencies
        "numpy", "psutil", "cryptography", "requests", "certifi",
        # Optional dependencies (may not be installed but handled gracefully)
        "wmi",
        # Core modules
        "core.api", "core.command_client", "core.forwarder", "core.segment_loader",
        "core.redis_forwarder", "core.redis_schema", "core.system_info",
        "core.device_identity", "core.models", "core.web_forwarder",
        "core.runtime_config_embedded",
        # Utils modules
        "utils.admin_check", "utils.config_loader", "utils.config_reader", "utils.file_encryption",
        "utils.kill_coinpoker", "utils.signal_logger", "utils.take_snapshot",
        "utils.nickname_detector", "utils.detection_keepalive", "utils.runtime_flags",
        "utils.network_info",
        # Segment modules (dynamically loaded but need to be discoverable)
        "segments.programs.process_scanner", "segments.programs.hash_and_signature_scanner",
        "segments.programs.content_analyzer", "segments.programs.obfuscation_detector",
        "segments.network.telegram_detector", "segments.network.traffic_monitor", "segments.network.web_monitor",
        "segments.behaviour.behaviour_detector", "segments.vm.vm_detector",
        "segments.auto.automation_detector", "segments.screen.screen_detector"
    )
    
    $hiddenImportsStr = ($hiddenImports | ForEach-Object { "--hidden-import=$_" }) -join " "
    
    # Add data directories (segments, core, utils) - config.txt is optional
    $addData = @(
        "segments;segments",
        "core;core",
        "utils;utils",
        "site/bot-rta-dashboard/configs;configs",
        "site/bot-rta-dashboard/configs/default_values;configs/default_values",
        "config_cache;config_cache"
    )
    
    # Note: config.txt is embedded via tools/embed_runtime_config.py
    # No need to include it as external file
    
    $addDataStr = ($addData | ForEach-Object { "--add-data `"$_`"" }) -join " "
    
    $cmd = "pyinstaller --clean --onefile --name=`"CoinPokerScanner`" $iconParam $addDataStr $hiddenImportsStr --console scanner.py"
    Write-Host "[Build] Command: $cmd" -ForegroundColor Gray
    Invoke-Expression $cmd
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "===================================================================" -ForegroundColor Green
    Write-Host "  BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host "===================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "[OK] Executable created: dist\CoinPokerScanner.exe" -ForegroundColor Green
    Write-Host ""
    Write-Host "[Info] Test the executable:" -ForegroundColor Cyan
    Write-Host "        dist\CoinPokerScanner.exe" -ForegroundColor White
    Write-Host ""
    Write-Host "[Info] To distribute:" -ForegroundColor Cyan
    Write-Host "        1. Copy dist\CoinPokerScanner.exe" -ForegroundColor White
    Write-Host "        2. (Optional) Copy config.txt if you want custom settings" -ForegroundColor White
    Write-Host "        3. Note: If config.txt is missing, .exe will auto-create a PROD config" -ForegroundColor Yellow
    Write-Host "        4. (Optional) Install Tesseract OCR if you re-enable nickname detection (see utils\\older)" -ForegroundColor White
    Write-Host ""
}
else {
    Write-Host ""
    Write-Host "[ERROR] Build failed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "[Info] Common issues:" -ForegroundColor Yellow
    Write-Host "        - If you see 'pathlib' error, run: pip uninstall pathlib" -ForegroundColor White
    Write-Host "        - If you see missing module errors, check requirements.txt" -ForegroundColor White
    Write-Host "        - Make sure you have all dependencies installed" -ForegroundColor White
    Write-Host ""
}

Read-Host "Press Enter to exit"
