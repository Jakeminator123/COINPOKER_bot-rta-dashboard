"""
Automatic CoinPoker MITM Capture System
========================================
Automatically:
1. Starts MITM proxy
2. Waits for CoinPoker to start
3. Captures all traffic while CoinPoker runs
4. Stops when CoinPoker closes
5. Repeats (waits for next CoinPoker session)

No manual interaction needed - just run and play CoinPoker!
"""

import os
import sys
import time
import subprocess
import signal
import psutil
from datetime import datetime
from pathlib import Path

# === CONFIG ===
PROXY_PORT = 8080
COINPOKER_PROCESS = "game.exe"
CHECK_INTERVAL = 5  # Check every 5 seconds
LOG_DIR = Path("mitm_logs")

# MITM script path
MITM_SCRIPT = Path(__file__).parent / "mitm_proxy.py"

class AutoCapture:
    def __init__(self):
        self.proxy_process = None
        self.running = True
        self.coinpoker_active = False
        
        # Create logs directory
        LOG_DIR.mkdir(exist_ok=True)
        
        # Setup signal handlers for clean shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
    
    def _signal_handler(self, signum, frame):
        """Handle Ctrl+C gracefully"""
        print("\n[AutoCapture] Shutdown requested...")
        self.running = False
        self.stop_proxy()
        sys.exit(0)
    
    def is_coinpoker_running(self) -> bool:
        """Check if CoinPoker is currently running"""
        try:
            for proc in psutil.process_iter(['name']):
                if proc.info['name'] and proc.info['name'].lower() == COINPOKER_PROCESS.lower():
                    return True
        except Exception:
            pass
        return False
    
    def start_proxy(self):
        """Start MITM proxy in background"""
        if self.proxy_process:
            return  # Already running
        
        print(f"[AutoCapture] Starting MITM proxy on port {PROXY_PORT}...")
        
        try:
            # Start mitmproxy as subprocess
            self.proxy_process = subprocess.Popen(
                [
                    sys.executable,
                    "-u",  # Unbuffered output
                    str(MITM_SCRIPT)
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == 'win32' else 0
            )
            
            # Give it a moment to start
            time.sleep(2)
            
            if self.proxy_process.poll() is None:
                print(f"[AutoCapture] ✓ MITM proxy started (PID: {self.proxy_process.pid})")
                print(f"[AutoCapture] Logs will be saved to: {LOG_DIR.absolute()}")
                return True
            else:
                print("[AutoCapture] ERROR: Proxy failed to start")
                self.proxy_process = None
                return False
                
        except Exception as e:
            print(f"[AutoCapture] ERROR starting proxy: {e}")
            self.proxy_process = None
            return False
    
    def stop_proxy(self):
        """Stop MITM proxy"""
        if not self.proxy_process:
            return
        
        print("[AutoCapture] Stopping MITM proxy...")
        
        try:
            # Terminate gracefully
            if sys.platform == 'win32':
                # Windows: Send Ctrl+C signal
                self.proxy_process.send_signal(signal.CTRL_C_EVENT)
            else:
                self.proxy_process.terminate()
            
            # Wait for it to stop (max 5 seconds)
            try:
                self.proxy_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # Force kill if it doesn't stop
                self.proxy_process.kill()
                self.proxy_process.wait()
            
            print("[AutoCapture] ✓ MITM proxy stopped")
            
        except Exception as e:
            print(f"[AutoCapture] Warning during proxy shutdown: {e}")
        
        finally:
            self.proxy_process = None
    
    def print_status(self, coinpoker_running: bool):
        """Print current status"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        if coinpoker_running:
            status = "🟢 CAPTURING"
            msg = "CoinPoker is running - capturing traffic"
        else:
            status = "🔵 WAITING"
            msg = "Waiting for CoinPoker to start..."
        
        print(f"[{timestamp}] {status} - {msg}")
    
    def run(self):
        """Main loop - automatically manage proxy based on CoinPoker state"""
        print("\n" + "="*70)
        print("  AUTOMATIC COINPOKER MITM CAPTURE")
        print("="*70)
        print()
        print("This script will automatically:")
        print("  1. Start MITM proxy when CoinPoker launches")
        print("  2. Capture all traffic while you play")
        print("  3. Stop proxy when you close CoinPoker")
        print("  4. Repeat for next session")
        print()
        print(f"Target process : {COINPOKER_PROCESS}")
        print(f"Proxy port     : {PROXY_PORT}")
        print(f"Logs directory : {LOG_DIR.absolute()}")
        print()
        print("SETUP REQUIRED (one-time):")
        print("  1. Install certificate: http://mitm.it")
        print("  2. Configure Windows proxy: localhost:8080")
        print()
        print("Press Ctrl+C to exit")
        print("="*70)
        print()
        
        last_status_print = 0
        status_print_interval = 30  # Print status every 30 seconds when waiting
        
        try:
            while self.running:
                coinpoker_running = self.is_coinpoker_running()
                
                # State transition: CoinPoker just started
                if coinpoker_running and not self.coinpoker_active:
                    print("\n" + "="*70)
                    print("🎮 COINPOKER DETECTED - STARTING CAPTURE")
                    print("="*70)
                    self.start_proxy()
                    self.coinpoker_active = True
                    last_status_print = time.time()
                
                # State transition: CoinPoker just closed
                elif not coinpoker_running and self.coinpoker_active:
                    print("\n" + "="*70)
                    print("🛑 COINPOKER CLOSED - STOPPING CAPTURE")
                    print("="*70)
                    self.stop_proxy()
                    self.coinpoker_active = False
                    
                    # Show logs summary
                    print("\nCaptured data saved to:")
                    for log_file in LOG_DIR.glob("*.log"):
                        size = log_file.stat().st_size / 1024  # KB
                        print(f"  - {log_file.name}: {size:.1f} KB")
                    
                    print("\nWaiting for next CoinPoker session...")
                    print("="*70 + "\n")
                    last_status_print = time.time()
                
                # Periodic status update when waiting
                elif not coinpoker_running and time.time() - last_status_print > status_print_interval:
                    self.print_status(coinpoker_running)
                    last_status_print = time.time()
                
                # Sleep before next check
                time.sleep(CHECK_INTERVAL)
        
        except KeyboardInterrupt:
            print("\n[AutoCapture] Shutdown requested...")
        
        finally:
            # Cleanup
            if self.proxy_process:
                self.stop_proxy()
            
            print("\n" + "="*70)
            print("  CAPTURE SESSION ENDED")
            print("="*70)
            print(f"\nAll logs saved to: {LOG_DIR.absolute()}")
            print("\nFiles captured:")
            for log_file in LOG_DIR.glob("*.log"):
                size = log_file.stat().st_size / 1024  # KB
                print(f"  - {log_file.name}: {size:.1f} KB")
            print()


def main():
    capture = AutoCapture()
    capture.run()


if __name__ == "__main__":
    main()

