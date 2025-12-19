"""
CoinPoker SSL MITM Proxy - FULL TRAFFIC CAPTURE
Intercepts and logs ALL HTTPS traffic from CoinPoker to find sensitive data
Captures nicknames, game state, player info, API calls, WebSocket data, etc.
"""

import re
import json
import os
from datetime import datetime
from mitmproxy import http, ctx
from mitmproxy.tools.main import mitmdump
import sys


# === CONFIG ===
TARGET_NICKNAME = "FastCarsss"  # Still highlight this if found
SEARCH_TERMS = [
    TARGET_NICKNAME,
    TARGET_NICKNAME.lower(),
    TARGET_NICKNAME.upper(),
]

# Keywords to highlight (case-insensitive)
HIGHLIGHT_KEYWORDS = [
    # Player info
    "nickname", "username", "playername", "player_name", "screenname",
    # Game data
    "balance", "chips", "stack", "pot", "bet", "hand", "cards",
    # Table info
    "table", "seat", "position", "blind", "ante",
    # Authentication
    "token", "session", "auth", "login", "password",
    # Game state
    "gamestate", "game_state", "action", "move", "fold", "call", "raise",
    # API endpoints
    "/api/", "/game/", "/player/", "/lobby/", "/table/",
]

# Log files
LOG_DIR = "mitm_logs"
FULL_LOG = os.path.join(LOG_DIR, "full_traffic.log")
HIGHLIGHTS_LOG = os.path.join(LOG_DIR, "highlights.log")
JSON_LOG = os.path.join(LOG_DIR, "json_data.log")
SSL_KEY_LOG = os.path.join(LOG_DIR, "sslkeys.log")

# Create logs directory
os.makedirs(LOG_DIR, exist_ok=True)

# Enable SSL key logging for Wireshark
os.environ['SSLKEYLOGFILE'] = SSL_KEY_LOG

# Stats
stats = {
    'total_requests': 0,
    'total_responses': 0,
    'json_found': 0,
    'highlights_found': 0,
    'target_matches': 0,
    'total_bytes': 0
}


def check_highlights(content: str, url: str) -> list:
    """Check if content contains any highlight keywords"""
    found = []
    content_lower = content.lower()
    
    for keyword in HIGHLIGHT_KEYWORDS:
        if keyword.lower() in content_lower:
            found.append(keyword)
    
    # Check for target nickname
    for term in SEARCH_TERMS:
        if term.lower() in content_lower:
            found.append(f"TARGET:{term}")
    
    return found


def log_traffic(flow: http.HTTPFlow, direction: str, content: str, highlights: list):
    """Log traffic to files and console"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    url = flow.request.pretty_url
    method = flow.request.method if direction == "REQUEST" else "RESPONSE"
    size = len(content)
    
    stats['total_bytes'] += size
    
    # Always log to full traffic log
    with open(FULL_LOG, 'a', encoding='utf-8') as f:
        f.write(f"\n{'='*80}\n")
        f.write(f"[{timestamp}] {direction} - {method}\n")
        f.write(f"URL: {url}\n")
        f.write(f"Size: {size} bytes\n")
        
        # Show request/response headers
        if direction == "REQUEST":
            f.write(f"Headers: {dict(flow.request.headers)}\n")
        else:
            if flow.response:
                f.write(f"Status: {flow.response.status_code}\n")
                f.write(f"Headers: {dict(flow.response.headers)}\n")
        
        # Try to parse as JSON
        is_json = False
        try:
            data = json.loads(content)
            is_json = True
            f.write(f"Content-Type: JSON\n")
            f.write(f"Content:\n{json.dumps(data, indent=2)}\n")
            
            # Also log to JSON-only file
            with open(JSON_LOG, 'a', encoding='utf-8') as jf:
                jf.write(f"\n{'='*80}\n")
                jf.write(f"[{timestamp}] {url}\n")
                jf.write(f"{json.dumps(data, indent=2)}\n")
            
            stats['json_found'] += 1
        except:
            # Not JSON - log as text (truncated if too long)
            f.write(f"Content-Type: Text/Binary\n")
            if size < 5000:
                f.write(f"Content:\n{content}\n")
            else:
                f.write(f"Content (first 5000 chars):\n{content[:5000]}\n...[truncated]\n")
        
        f.write(f"{'='*80}\n")
    
    # If highlights found, log to highlights file and print to console
    if highlights:
        stats['highlights_found'] += 1
        
        # Check if target nickname is in highlights
        is_target = any("TARGET:" in h for h in highlights)
        if is_target:
            stats['target_matches'] += 1
        
        # Console output with color
        marker = "*** TARGET DETECTED ***" if is_target else "*** HIGHLIGHT DETECTED ***"
        print(f"\n{'='*80}")
        print(f"{marker}")
        print(f"{'='*80}")
        print(f"Time      : {timestamp}")
        print(f"Direction : {direction}")
        print(f"Method    : {method}")
        print(f"URL       : {url}")
        print(f"Size      : {size} bytes")
        print(f"Keywords  : {', '.join(highlights)}")
        
        # Show content preview
        try:
            data = json.loads(content)
            print(f"Type      : JSON")
            preview = json.dumps(data, indent=2)
            if len(preview) > 800:
                preview = preview[:800] + "\n...[truncated]"
            print(f"Preview   :\n{preview}")
        except:
            print(f"Type      : Text/Binary")
            if size < 500:
                print(f"Content   :\n{content}")
            else:
                print(f"Preview   : {content[:500]}...[truncated]")
        
        print(f"{'='*80}\n")
        
        # Log to highlights file
        with open(HIGHLIGHTS_LOG, 'a', encoding='utf-8') as f:
            f.write(f"\n{'='*80}\n")
            f.write(f"[{timestamp}] {marker}\n")
            f.write(f"URL: {url}\n")
            f.write(f"Keywords: {', '.join(highlights)}\n")
            f.write(f"Content:\n{content if size < 2000 else content[:2000] + '...[truncated]'}\n")
            f.write(f"{'='*80}\n")


class CoinPokerInterceptor:
    def request(self, flow: http.HTTPFlow) -> None:
        """
        Intercepts ALL outgoing requests and logs everything.
        """
        stats['total_requests'] += 1
        
        # Log ALL requests, not just those with target
        if flow.request.content:
            try:
                content = flow.request.content.decode('utf-8', errors='ignore')
                
                # Check for highlights
                highlights = check_highlights(content, flow.request.pretty_url)
                
                # Log traffic (all traffic, highlight if interesting)
                log_traffic(flow, "REQUEST", content, highlights)
                
            except Exception as e:
                # Log error but continue
                print(f"[ERROR] Request processing failed: {e}")
    
    def response(self, flow: http.HTTPFlow) -> None:
        """
        Intercepts ALL incoming responses and logs everything.
        """
        stats['total_responses'] += 1
        
        # Log ALL responses
        if flow.response and flow.response.content:
            try:
                content = flow.response.content.decode('utf-8', errors='ignore')
                
                # Check for highlights
                highlights = check_highlights(content, flow.request.pretty_url)
                
                # Log traffic (all traffic, highlight if interesting)
                log_traffic(flow, "RESPONSE", content, highlights)
                
            except Exception as e:
                # Log error but continue
                print(f"[ERROR] Response processing failed: {e}")


def start():
    """
    Entry point for mitmproxy addon.
    """
    return CoinPokerInterceptor()


# For standalone execution
if __name__ == "__main__":
    print("\n" + "="*80)
    print("COINPOKER SSL MITM PROXY - FULL TRAFFIC CAPTURE MODE")
    print("="*80)
    print(f"Target nickname    : {TARGET_NICKNAME}")
    print(f"Logs directory     : {LOG_DIR}/")
    print(f"  - Full traffic   : {FULL_LOG}")
    print(f"  - Highlights     : {HIGHLIGHTS_LOG}")
    print(f"  - JSON data      : {JSON_LOG}")
    print(f"  - SSL keys       : {SSL_KEY_LOG}")
    print()
    print(f"Monitoring {len(HIGHLIGHT_KEYWORDS)} keywords:")
    print(f"  {', '.join(HIGHLIGHT_KEYWORDS[:10])}...")
    print()
    print("SETUP INSTRUCTIONS:")
    print("="*80)
    print("1. This proxy will start on: http://localhost:8080")
    print("2. Install mitmproxy certificate:")
    print("   - Visit http://mitm.it in your browser")
    print("   - Download and install certificate for Windows")
    print("3. Configure Windows to use proxy:")
    print("   - Settings > Network > Proxy")
    print("   - Manual proxy: localhost:8080")
    print("4. Start CoinPoker and play a few hands")
    print("5. ALL HTTPS traffic will be captured and logged!")
    print()
    print("WHAT GETS LOGGED:")
    print("  - Every HTTP request/response (full_traffic.log)")
    print("  - JSON data separately (json_data.log)")
    print("  - Interesting keywords highlighted (highlights.log)")
    print("  - SSL keys for Wireshark decryption (sslkeys.log)")
    print()
    print("Press Ctrl+C to stop and view statistics")
    print("="*80 + "\n")
    
    # Initialize log files
    for log_file in [FULL_LOG, HIGHLIGHTS_LOG, JSON_LOG]:
        with open(log_file, 'w', encoding='utf-8') as f:
            f.write(f"CoinPoker MITM Log - Started {datetime.now()}\n")
            f.write("="*80 + "\n\n")
    
    try:
        # Start mitmproxy
        from mitmproxy.tools import cmdline
        from mitmproxy import options
        from mitmproxy.tools.main import mitmdump
        
        sys.argv = [
            'mitmdump',
            '-s', __file__,
            '--listen-host', '0.0.0.0',
            '--listen-port', '8080',
            '--set', 'stream_large_bodies=1m',
        ]
        
        mitmdump()
    
    except KeyboardInterrupt:
        print("\n\n" + "="*80)
        print("PROXY STOPPED - CAPTURE STATISTICS")
        print("="*80)
        print(f"Total requests     : {stats['total_requests']}")
        print(f"Total responses    : {stats['total_responses']}")
        print(f"Total data captured: {stats['total_bytes']:,} bytes ({stats['total_bytes']/1024/1024:.2f} MB)")
        print(f"JSON objects found : {stats['json_found']}")
        print(f"Highlights found   : {stats['highlights_found']}")
        print(f"Target matches     : {stats['target_matches']}")
        print()
        print("LOG FILES:")
        print(f"  Full traffic : {FULL_LOG}")
        print(f"  Highlights   : {HIGHLIGHTS_LOG}")
        print(f"  JSON data    : {JSON_LOG}")
        print(f"  SSL keys     : {SSL_KEY_LOG}")
        print()
        print("NEXT STEPS:")
        print("  1. Review highlights.log for sensitive data")
        print("  2. Search json_data.log for player information")
        print("  3. Use SSL keys with Wireshark for packet analysis")
        print("  4. Check full_traffic.log for complete capture")
        print("="*80)


addons = [CoinPokerInterceptor()]

