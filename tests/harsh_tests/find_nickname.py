"""
Simple CoinPoker Nickname Finder
=================================
Monitors CoinPoker API traffic and reports player nicknames with exact location.

Usage:
  Run: find_nickname.bat
  Then start CoinPoker and login
"""

import json
import sys
import os
from datetime import datetime
from mitmproxy import http
from mitmproxy.tools.main import mitmdump


class NicknameFinder:
    def __init__(self):
        self.found_nicknames = set()
        self.log_file = "nickname_detections.log"
        self.nickname_list = []  # Store all unique nicknames found
    
    def log(self, message):
        """Log to console and file"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_msg = f"[{timestamp}] {message}"
        print(log_msg)
        
        try:
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(log_msg + "\n")
        except:
            pass
    
    def find_in_json(self, obj, path="", results=None):
        """Recursively find all nickname-related fields in JSON"""
        if results is None:
            results = []
        
        if isinstance(obj, dict):
            for key, value in obj.items():
                current_path = f"{path}.{key}" if path else key
                key_lower = key.lower()
                
                # Check if this looks like a nickname field
                if any(keyword in key_lower for keyword in ["nick", "name", "username", "player"]):
                    if isinstance(value, str) and value and len(value) > 2:
                        results.append({
                            "path": current_path,
                            "key": key,
                            "value": value
                        })
                
                # Recurse
                self.find_in_json(value, current_path, results)
                
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                self.find_in_json(item, f"{path}[{i}]", results)
        
        return results
    
    def check_content(self, flow: http.HTTPFlow, direction: str):
        """Check flow content for nicknames"""
        # Only check CoinPoker traffic
        host = flow.request.pretty_host.lower()
        if "coinpoker" not in host:
            return
        
        # Get content
        content = None
        try:
            if direction == "REQUEST" and flow.request.content:
                content = flow.request.content.decode('utf-8', errors='ignore')
            elif direction == "RESPONSE" and flow.response and flow.response.content:
                content = flow.response.content.decode('utf-8', errors='ignore')
        except:
            return
        
        if not content or len(content) < 10:
            return
        
        # Try to parse as JSON
        try:
            data = json.loads(content)
            nicknames = self.find_in_json(data)
            
            if nicknames:
                # Found something!
                url = flow.request.pretty_url
                method = flow.request.method
                
                for nick_info in nicknames:
                    nickname = nick_info["value"]
                    path = nick_info["path"]
                    
                    # Create unique key to avoid duplicates
                    detection_key = f"{nickname}:{url}:{path}"
                    
                    if detection_key not in self.found_nicknames:
                        self.found_nicknames.add(detection_key)
                        
                        # Add to nickname list if not already there
                        if nickname not in self.nickname_list:
                            self.nickname_list.append(nickname)
                        
                        print("\n" + "="*70)
                        print("🎯 NICKNAME DETECTED!")
                        print("="*70)
                        self.log(f"Nickname: {nickname}")
                        self.log(f"URL: {url}")
                        self.log(f"Method: {method}")
                        self.log(f"Direction: {direction}")
                        self.log(f"JSON Path: {path}")
                        print()
                        print("To extract this programmatically:")
                        print(f"  1. Monitor URL: {url}")
                        print(f"  2. Parse JSON response")
                        print(f"  3. Access field: {path}")
                        print()
                        print(f"Total unique nicknames found: {len(self.nickname_list)}")
                        if len(self.nickname_list) <= 5:
                            print(f"Nicknames: {', '.join(self.nickname_list)}")
                        print("="*70 + "\n")
        
        except json.JSONDecodeError:
            # Not JSON, try simple text search for common patterns
            if any(keyword in content.lower() for keyword in ["nick", "username", "player"]):
                # Found potential nickname data but not valid JSON
                pass


# Global instance
finder = NicknameFinder()


def request(flow: http.HTTPFlow):
    """Hook for requests"""
    finder.check_content(flow, "REQUEST")


def response(flow: http.HTTPFlow):
    """Hook for responses"""
    finder.check_content(flow, "RESPONSE")


if __name__ == "__main__":
    print("\n" + "="*70)
    print("  COINPOKER NICKNAME FINDER")
    print("="*70)
    print()
    print("Status: Running and monitoring CoinPoker traffic...")
    print("Proxy: localhost:8080")
    print()
    print("Instructions:")
    print("  1. Start CoinPoker")
    print("  2. Login to your account")
    print("  3. Nicknames will be detected and shown here")
    print()
    print("Detections will be saved to: nickname_detections.log")
    print()
    print("Press Ctrl+C to exit")
    print("="*70 + "\n")
    
    # Start mitmdump
    sys.argv = [
        "mitmdump",
        "-s", __file__,
        "-p", "8080",
        "--set", "confdir=~/.mitmproxy",
        "--set", "ssl_insecure=true"
    ]
    
    try:
        mitmdump()
    except KeyboardInterrupt:
        print("\n\n" + "="*70)
        print("  SESSION ENDED")
        print("="*70)
        print(f"\nTotal unique nicknames found: {len(finder.found_nicknames)}")
        print(f"Total detections: {len(finder.nickname_list)}")
        if finder.nickname_list:
            print("\nNicknames detected:")
            for nick in set(finder.nickname_list):
                print(f"  - {nick}")
        print(f"\nLog file: {finder.log_file}")
        print("="*70 + "\n")

