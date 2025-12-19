# CoinPoker Traffic Interceptor
> Real-time HTTPS decryption and nickname detection for CoinPoker

```ascii
╔══════════════════════════════════════════════════════════════╗
║                   MITM PROXY ARCHITECTURE                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║   CoinPoker App                                              ║
║        │                                                     ║
║        │ HTTPS (encrypted)                                   ║
║        ↓                                                     ║
║   [MITM Proxy :8080]  ← Intercepts & Decrypts               ║
║        │                                                     ║
║        ├─→ Search: "FastCarsss" ✓ FOUND!                    ║
║        │                                                     ║
║        ↓ HTTPS (re-encrypted)                                ║
║   Internet                                                   ║
║   api.coinpokerbackend.com                                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

## 🎯 Quick Start

### 1️⃣ Install Certificate (Once)
```bash
run_mitm_proxy.bat              # Start proxy
# Visit http://mitm.it in browser
# Download & install certificate to "Trusted Root"
```

### 2️⃣ Enable Proxy
```bash
setup_windows_proxy.bat         # Enable system proxy
```

### 3️⃣ Monitor
```bash
run_mitm_proxy.bat              # Start monitoring
# Launch CoinPoker
# Detections appear in console + coinpoker_traffic.log
```

### 4️⃣ Stop
```bash
Ctrl+C                          # Stop proxy
disable_windows_proxy.bat       # Disable system proxy
```

---

## 📊 What We Discovered

### API Endpoints
```
GET  https://api.coinpokerbackend.com/init/5/en
POST https://api.coinpokerbackend.com/init/health/update
WSS  wss://proxy1.coinpokerbackend.com/
```

### Nickname Detection
```json
{
  "nick": "FastCarsss",
  "mac_addresses": "74:56:3C:30:01:E6",
  "os_login_name": "jakob",
  "display_resolutions": "3840x2160"
}
```

### SSL/TLS Details
```
Protocol: TLS 1.3
Cipher: TLS_AES_128_GCM_SHA256
Certificate: Cloudflare Inc
Key Exchange: X25519
```

---

## 🔐 Extracting Encryption Keys

### Method 1: SSLKEYLOGFILE (Wireshark)
```python
# Add to mitm_proxy.py
import os
os.environ['SSLKEYLOGFILE'] = 'sslkeys.log'
```

Then open `sslkeys.log`:
```
CLIENT_RANDOM 8ba9e8... 3f4d8c2a1b...
CLIENT_HANDSHAKE_TRAFFIC_SECRET 8ba9... fa3c...
SERVER_HANDSHAKE_TRAFFIC_SECRET 8ba9... 2b1a...
```

Use with Wireshark to decrypt captured `.pcap` files:
```
Wireshark → Preferences → Protocols → TLS
→ (Pre)-Master-Secret log filename: sslkeys.log
```

### Method 2: Certificate Export
```bash
# Mitmproxy stores certificates here:
%USERPROFILE%\.mitmproxy\

Files:
  mitmproxy-ca.pem         # CA certificate
  mitmproxy-ca-cert.pem    # Public cert
  mitmproxy-ca-cert.p12    # Windows certificate
```

---

## 🛡️ Defense Against This Attack

### Certificate Pinning (How Poker Sites Can Block This)

```ascii
┌─────────────────────────────────────────────────────┐
│  Without Pinning (CoinPoker - Vulnerable)          │
├─────────────────────────────────────────────────────┤
│  Client: "Is this cert trusted?"                    │
│  Windows: "Yes, it's in Trusted Root" ✓             │
│  Client: "OK, connecting..."                        │
│  Result: MITM works ❌                               │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  With Pinning (PokerStars - Secure)                │
├─────────────────────────────────────────────────────┤
│  Client: "Is cert hash == MY_EXPECTED_HASH?"        │
│  Windows: "It's trusted but hash is different"      │
│  Client: "WRONG CERT - REFUSING!" ✗                 │
│  Result: MITM blocked ✅                             │
└─────────────────────────────────────────────────────┘
```

**Implementation:**
```python
# Hard-code in poker client
EXPECTED_CERT = "sha256/Vjs8r4z+80wjNcr1..."

if actual_cert != EXPECTED_CERT:
    exit("Certificate mismatch - MITM detected!")
```

**Sites Using Certificate Pinning:**
- ✅ PokerStars
- ✅ 888poker  
- ✅ GGPoker
- ❌ CoinPoker (vulnerable)

---

## 🔄 Approaches Tested

```ascii
╔════════════════════════════════════════════════════════╗
║  Method               │ Result  │ Why?                 ║
╠════════════════════════════════════════════════════════╣
║  Memory Scanning      │ FAILED  │ Qt WebEngine/JS      ║
║  Packet Sniffing      │ FAILED  │ HTTPS encrypted      ║
║  Cache Scanning       │ FAILED  │ No cached data       ║
║  MITM Proxy          │ SUCCESS │ Decrypts SSL/TLS ✓   ║
╚════════════════════════════════════════════════════════╝
```

---

## 🤖 Automation & Integration

### Difficulty: ⭐⭐⭐ MEDIUM

```python
# automated_monitor.py
import subprocess

class Monitor:
    def start(self):
        # Enable proxy
        subprocess.run(['reg', 'add', 'HKCU\\...\\ProxyEnable', ...])
        # Start mitmproxy
        self.proxy = subprocess.Popen(['mitmdump', '-s', 'mitm_proxy.py'])
    
    def on_detection(self, nickname):
        # Send to your dashboard
        requests.post('https://your-api.com/alerts', json={
            'nickname': nickname,
            'timestamp': datetime.now(),
            'source': 'coinpoker'
        })
```

### Integration Architecture

```ascii
                    ┌─────────────────────┐
                    │  Security Dashboard │
                    │   (Your Backend)    │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
         ┌────▼────┐      ┌───▼────┐      ┌───▼────┐
         │  MITM   │      │  OCR   │      │ Manual │
         │  Proxy  │      │ Screen │      │ Report │
         │(CoinPkr)│      │  Scan  │      │  API   │
         └─────────┘      └────────┘      └────────┘
```

### Time Estimates

| Task | Difficulty | Time |
|------|-----------|------|
| Basic setup | ⭐⭐ | 1h |
| Certificate automation | ⭐⭐⭐ | 4h |
| Dashboard integration | ⭐⭐ | 2h |
| Multi-site support | ⭐⭐⭐⭐ | 2d |

---

## 💡 Better Alternatives (For Poker Sites)

### Option 1: Official Security API ✅ BEST
```python
# Poker site provides secure endpoint
GET /api/v1/security/players?table_id=123
Authorization: Bearer <security_tool_token>

Response:
{
  "players": [
    {"nick": "FastCarsss", "flagged": true}
  ]
}
```

### Option 2: Client-Side Hook
```javascript
// Built into poker client
pokerClient.on('player_joined', (player) => {
    securityTool.notify(player.nickname);
});
```

### Option 3: OCR Fallback
```python
# Works everywhere, slower
screenshot → OCR → detect "FastCarsss"
```

---

## 📁 Files

**Active:**
- `mitm_proxy.py` - Main interceptor
- `run_mitm_proxy.bat` - Launcher
- `setup_windows_proxy.bat` - Enable proxy
- `disable_windows_proxy.bat` - Disable proxy
- `coinpoker_traffic.log` - Detection log

**Removed (failed approaches):**
- ~~Memory scanner~~
- ~~Packet sniffer~~  
- ~~Cache scanner~~

---

## ⚙️ Technical Details

**Requirements:**
- Python 3.13+
- mitmproxy (auto-installed)
- Windows 10/11
- Admin (for cert install)

**Why It Works:**
```
✓ CoinPoker respects system proxy
✓ No certificate pinning
✓ Trusts Windows Trusted Root certs
✗ Would fail on PokerStars (has pinning)
```

---

## ⚠️ Security Warning

This tool:
- Intercepts **ALL** system HTTPS traffic
- Requires installing root certificate (security risk)
- For educational/research purposes only
- Always disable proxy when done

---

## 🎓 Lessons Learned

1. **Memory scanning** → Fails on Qt WebEngine apps
2. **Packet sniffing** → Useless against HTTPS
3. **MITM proxy** → Most reliable (if no pinning)
4. **Certificate pinning** → Defeats MITM completely
5. **Best solution** → Poker sites should provide official APIs

---

**Status:** ✅ Working (CoinPoker only)  
**Date:** November 20, 2025

