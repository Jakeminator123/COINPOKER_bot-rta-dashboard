# Start monitoring script with watch mode
# Right-click -> Run with PowerShell

Set-Location $PSScriptRoot\..
python scripts\monitor_load.py --watch --interval 60

Read-Host "Press Enter to exit"

