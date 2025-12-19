"""
Extract SSL/TLS Keys from CoinPoker Traffic
Automatically saves all encryption keys for Wireshark decryption
"""

import os
import shutil
from pathlib import Path

def extract_keys():
    print("\n" + "="*60)
    print("SSL/TLS KEY EXTRACTOR")
    print("="*60)
    
    # Mitmproxy cert directory
    mitm_dir = Path.home() / ".mitmproxy"
    
    if not mitm_dir.exists():
        print("\n[ERROR] Mitmproxy directory not found!")
        print("Run run_mitm_proxy.bat first to generate certificates.")
        input("\nPress Enter to exit...")
        return
    
    # Create output directory
    output_dir = Path("ssl_keys")
    output_dir.mkdir(exist_ok=True)
    
    print(f"\n[INFO] Extracting keys from: {mitm_dir}")
    print(f"[INFO] Saving to: {output_dir}\n")
    
    # Files to extract
    files_to_copy = {
        "mitmproxy-ca.pem": "CA Certificate (PEM)",
        "mitmproxy-ca-cert.pem": "Public Certificate",
        "mitmproxy-ca-cert.p12": "Windows Certificate",
        "mitmproxy-dhparam.pem": "DH Parameters",
    }
    
    found_files = []
    
    for filename, description in files_to_copy.items():
        src = mitm_dir / filename
        if src.exists():
            dst = output_dir / filename
            shutil.copy2(src, dst)
            print(f"[✓] {description}")
            print(f"    → {dst}")
            found_files.append(str(dst))
        else:
            print(f"[✗] {description} - NOT FOUND")
    
    print("\n" + "="*60)
    print("EXTRACTED FILES")
    print("="*60)
    
    if found_files:
        for f in found_files:
            size = os.path.getsize(f)
            print(f"{f} ({size} bytes)")
        
        print("\n" + "="*60)
        print("HOW TO USE WITH WIRESHARK")
        print("="*60)
        print("""
1. Capture traffic with Wireshark while running MITM proxy
2. Save capture as .pcap file
3. In Wireshark:
   - Edit → Preferences → Protocols → TLS
   - Set '(Pre)-Master-Secret log filename' to: sslkeys.log
   - Click OK
4. Wireshark will decrypt HTTPS traffic automatically!
        """)
    else:
        print("\n[!] No certificates found")
        print("[!] Make sure to run run_mitm_proxy.bat first")
    
    print("="*60)
    input("\nPress Enter to exit...")


if __name__ == "__main__":
    extract_keys()

