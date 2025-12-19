"""
Test Certificate Pinning on Other Poker Sites
Verifies if other poker sites implement certificate pinning
"""

import subprocess
import time
import sys
from pathlib import Path

# Sites to test
POKER_SITES = {
    "PokerStars": {
        "process": "PokerStars.exe",
        "description": "PokerStars client"
    },
    "888poker": {
        "process": "888poker.exe",
        "description": "888poker client"
    },
    "GGPoker": {
        "process": "GGPoker.exe",
        "description": "GGPoker client"
    },
    "PartyPoker": {
        "process": "PartyPoker.exe",
        "description": "PartyPoker client"
    },
    "Unibet": {
        "process": "UnibetPoker.exe",
        "description": "Unibet Poker client"
    },
    "CoinPoker": {
        "process": "game.exe",
        "description": "CoinPoker client (KNOWN VULNERABLE)"
    }
}


def check_proxy_enabled():
    """Check if Windows proxy is enabled"""
    try:
        result = subprocess.run(
            ['reg', 'query', 
             'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
             '/v', 'ProxyEnable'],
            capture_output=True,
            text=True
        )
        
        if '0x1' in result.stdout:
            return True
        return False
    except:
        return False


def check_process_running(process_name):
    """Check if poker client process is running"""
    try:
        result = subprocess.run(
            ['tasklist', '/FI', f'IMAGENAME eq {process_name}'],
            capture_output=True,
            text=True
        )
        return process_name.lower() in result.stdout.lower()
    except:
        return False


def test_site(site_name, config):
    """Test if a poker site accepts MITM proxy"""
    print(f"\n{'='*60}")
    print(f"Testing: {site_name}")
    print(f"{'='*60}")
    print(f"Process: {config['process']}")
    print(f"Description: {config['description']}")
    
    # Check if proxy is enabled
    if not check_proxy_enabled():
        print("\n[!] WARNING: System proxy not enabled!")
        print("[!] Run setup_windows_proxy.bat first")
        return None
    
    print("\n[✓] System proxy is enabled")
    
    # Check if process is running
    if not check_process_running(config['process']):
        print(f"\n[!] {config['process']} is NOT running")
        print(f"[!] Please start {site_name} and try again")
        return None
    
    print(f"[✓] {config['process']} is running")
    
    # Check for connection errors
    print("\n[INFO] Checking for certificate pinning...")
    print("[INFO] Look for:")
    print("  • Connection refused")
    print("  • Certificate errors")
    print("  • Security warnings")
    print("  • Connection timeout")
    
    print("\n[INFO] If connection succeeds → NO certificate pinning (vulnerable)")
    print("[INFO] If connection fails → Certificate pinning implemented (secure)")
    
    return {
        "site": site_name,
        "process": config['process'],
        "proxy_enabled": True,
        "process_running": True,
        "status": "MANUAL_CHECK_REQUIRED"
    }


def main():
    print("\n" + "="*60)
    print("POKER SITE CERTIFICATE PINNING TESTER")
    print("="*60)
    print("\nThis tool helps verify if poker sites implement certificate pinning.")
    print("\nPREREQUISITES:")
    print("  1. Mitmproxy certificate installed")
    print("  2. System proxy enabled (setup_windows_proxy.bat)")
    print("  3. Mitmproxy running (run_mitm_proxy.bat)")
    print("  4. Poker client running")
    
    print("\n" + "="*60)
    print("TESTING METHODOLOGY")
    print("="*60)
    print("""
1. Start mitmproxy: run_mitm_proxy.bat
2. Enable proxy: setup_windows_proxy.bat
3. Start poker client
4. Observe behavior:

   SECURE (Certificate Pinning):
   → Connection refused
   → Certificate error
   → Security warning
   → Cannot connect

   VULNERABLE (No Pinning):
   → Connection succeeds
   → No warnings
   → Traffic intercepted
   → Like CoinPoker
    """)
    
    print("\n" + "="*60)
    print("AVAILABLE SITES TO TEST")
    print("="*60)
    
    for idx, (site, config) in enumerate(POKER_SITES.items(), 1):
        running = "✓ RUNNING" if check_process_running(config['process']) else "✗ NOT RUNNING"
        print(f"{idx}. {site:15} - {config['process']:20} [{running}]")
    
    print("\n" + "="*60)
    print("MANUAL TESTING REQUIRED")
    print("="*60)
    print("""
To test each site:

1. Start the poker client
2. Try to connect/login
3. Check mitmproxy window for:
   
   If you see traffic → VULNERABLE (like CoinPoker)
   If connection fails → SECURE (certificate pinning)

4. Check client for error messages:
   
   "Certificate verification failed" → SECURE
   "Connection refused" → SECURE
   Normal connection → VULNERABLE
    """)
    
    print("\n" + "="*60)
    print("KNOWN STATUS")
    print("="*60)
    print("✅ CoinPoker: CONFIRMED VULNERABLE (tested)")
    print("❓ Other sites: UNKNOWN (not tested)")
    print("="*60)
    
    input("\nPress Enter to exit...")


if __name__ == "__main__":
    main()

