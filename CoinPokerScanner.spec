# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['scanner.py'],
    pathex=[],
    binaries=[],
    datas=[('segments', 'segments'), ('core', 'core'), ('utils', 'utils'), ('site/bot-rta-dashboard/configs', 'configs'), ('site/bot-rta-dashboard/configs/default_values', 'configs/default_values'), ('config_cache', 'config_cache')],
    hiddenimports=['win32timezone', 'win32api', 'win32con', 'win32gui', 'win32process', 'win32ui', 'winreg', 'pytesseract', 'PIL', 'PIL.Image', 'PIL.ImageEnhance', 'PIL.ImageGrab', 'numpy', 'psutil', 'cryptography', 'requests', 'certifi', 'redis', 'wmi', 'core.api', 'core.command_client', 'core.redis_command_client', 'core.forwarder', 'core.segment_loader', 'core.redis_forwarder', 'core.redis_schema', 'core.system_info', 'core.device_identity', 'core.models', 'core.web_forwarder', 'core.runtime_config_embedded', 'utils.admin_check', 'utils.config_loader', 'utils.config_reader', 'utils.file_encryption', 'utils.kill_coinpoker', 'utils.signal_logger', 'utils.take_snapshot', 'utils.nickname_detector', 'utils.detection_keepalive', 'utils.runtime_flags', 'utils.network_info', 'segments.programs.process_scanner', 'segments.programs.hash_and_signature_scanner', 'segments.programs.content_analyzer', 'segments.programs.obfuscation_detector', 'segments.network.telegram_detector', 'segments.network.traffic_monitor', 'segments.network.web_monitor', 'segments.behaviour.behaviour_detector', 'segments.vm.vm_detector', 'segments.auto.automation_detector', 'segments.screen.screen_detector'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='CoinPokerScanner',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['CoinPoker_cropped.ico'],
)
