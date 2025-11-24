# PowerShell script to simulate 4000 players
# Each player sends a batch every 92 seconds, just like a real scanner.py instance

Write-Host "Starting 4000 player simulation..." -ForegroundColor Green
Write-Host "This simulates 4000 unique scanner.py instances" -ForegroundColor Cyan
Write-Host ""

# Activate virtual environment if it exists
if (Test-Path ".venv\Scripts\Activate.ps1") {
    & .\.venv\Scripts\Activate.ps1
}

# Run the simulator with optimized settings for 4000 players
python simulator.py `
    --players 4000 `
    --duration 600 `
    --batch-interval 92 `
    --max-workers 200 `
    --burst-start

# Note: The simulator will:
# - Automatically enable burst mode for fast startup
# - Use 200 worker threads (optimized for 4000 players)
# - Each player sends a unique batch every 92 seconds
# - Total: ~43 batches per second (4000 players / 92 seconds)
# - Each batch contains different detections with randomized values
