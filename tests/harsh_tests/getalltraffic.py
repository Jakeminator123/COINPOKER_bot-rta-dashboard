"""
Get All CoinPoker Traffic
==========================
Captures ALL CoinPoker API traffic with full details.
Logs everything for analysis - URLs, headers, JSON payloads, etc.

This is more comprehensive than find_nickname.py which only looks for nicknames.
"""

import json
import sys
import os
from datetime import datetime
from mitmproxy import http
from mitmproxy.tools.main import mitmdump


class TrafficCapture:
    def __init__(self):
        self.request_count = 0
        self.response_count = 0
        self.log_dir = "traffic_logs"
        os.makedirs(self.log_dir, exist_ok=True)
        
        # Create timestamped log files
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.full_log = os.path.join(self.log_dir, f"full_traffic_{timestamp}.log")
        self.json_log = os.path.join(self.log_dir, f"json_data_{timestamp}.json")
        self.summary_log = os.path.join(self.log_dir, f"summary_{timestamp}.txt")
        
        # JSON data collection
        self.json_data = []
        
        self.log(f"Traffic capture started at {datetime.now()}")
        self.log(f"Logs directory: {os.path.abspath(self.log_dir)}")
        self.log("="*70)
    
    def log(self, message):
        """Log to console and file"""
        print(message)
        try:
            with open(self.full_log, "a", encoding="utf-8") as f:
                f.write(message + "\n")
        except:
            pass
    
    def log_request(self, flow: http.HTTPFlow):
        """Log request details"""
        # Only log CoinPoker traffic
        host = flow.request.pretty_host.lower()
        if "coinpoker" not in host:
            return
        
        self.request_count += 1
        
        self.log("\n" + "="*70)
        self.log(f"REQUEST #{self.request_count}")
        self.log("="*70)
        self.log(f"Time: {datetime.now().strftime('%H:%M:%S.%f')[:-3]}")
        self.log(f"Method: {flow.request.method}")
        self.log(f"URL: {flow.request.pretty_url}")
        self.log(f"Host: {flow.request.pretty_host}")
        
        # Headers
        if flow.request.headers:
            self.log("\nHeaders:")
            for key, value in flow.request.headers.items():
                self.log(f"  {key}: {value}")
        
        # Body/Content
        if flow.request.content:
            try:
                content = flow.request.content.decode('utf-8', errors='ignore')
                if content and len(content) > 0:
                    self.log(f"\nContent ({len(content)} bytes):")
                    
                    # Try to parse as JSON
                    try:
                        data = json.loads(content)
                        formatted = json.dumps(data, indent=2, ensure_ascii=False)
                        self.log(formatted)
                        
                        # Save to JSON log
                        self.json_data.append({
                            "timestamp": datetime.now().isoformat(),
                            "direction": "REQUEST",
                            "method": flow.request.method,
                            "url": flow.request.pretty_url,
                            "data": data
                        })
                    except:
                        # Not JSON, show raw
                        self.log(content[:500])  # First 500 chars
                        if len(content) > 500:
                            self.log(f"... ({len(content) - 500} more bytes)")
            except:
                pass
    
    def log_response(self, flow: http.HTTPFlow):
        """Log response details"""
        # Only log CoinPoker traffic
        host = flow.request.pretty_host.lower()
        if "coinpoker" not in host:
            return
        
        self.response_count += 1
        
        self.log("\n" + "-"*70)
        self.log(f"RESPONSE #{self.response_count}")
        self.log("-"*70)
        self.log(f"Time: {datetime.now().strftime('%H:%M:%S.%f')[:-3]}")
        self.log(f"Status: {flow.response.status_code}")
        self.log(f"URL: {flow.request.pretty_url}")
        
        # Headers
        if flow.response.headers:
            self.log("\nResponse Headers:")
            for key, value in flow.response.headers.items():
                self.log(f"  {key}: {value}")
        
        # Body/Content
        if flow.response.content:
            try:
                content = flow.response.content.decode('utf-8', errors='ignore')
                if content and len(content) > 0:
                    self.log(f"\nResponse Content ({len(content)} bytes):")
                    
                    # Try to parse as JSON
                    try:
                        data = json.loads(content)
                        formatted = json.dumps(data, indent=2, ensure_ascii=False)
                        self.log(formatted)
                        
                        # Save to JSON log
                        self.json_data.append({
                            "timestamp": datetime.now().isoformat(),
                            "direction": "RESPONSE",
                            "status": flow.response.status_code,
                            "url": flow.request.pretty_url,
                            "data": data
                        })
                    except:
                        # Not JSON, show raw
                        self.log(content[:500])
                        if len(content) > 500:
                            self.log(f"... ({len(content) - 500} more bytes)")
            except:
                pass
    
    def save_summary(self):
        """Save session summary"""
        summary = f"""
CoinPoker Traffic Capture Summary
==================================
Session ended: {datetime.now()}

Statistics:
-----------
Total Requests:  {self.request_count}
Total Responses: {self.response_count}
JSON Objects:    {len(self.json_data)}

Files created:
--------------
Full Log:    {self.full_log}
JSON Data:   {self.json_log}
Summary:     {self.summary_log}

To analyze JSON data:
---------------------
python -m json.tool {self.json_log}
"""
        print(summary)
        
        try:
            with open(self.summary_log, "w", encoding="utf-8") as f:
                f.write(summary)
        except:
            pass
        
        # Save JSON data
        if self.json_data:
            try:
                with open(self.json_log, "w", encoding="utf-8") as f:
                    json.dump(self.json_data, f, indent=2, ensure_ascii=False)
            except:
                pass


# Global instance
capturer = TrafficCapture()


def request(flow: http.HTTPFlow):
    """Hook for requests"""
    capturer.log_request(flow)


def response(flow: http.HTTPFlow):
    """Hook for responses"""
    capturer.log_response(flow)


def done():
    """Called when proxy stops"""
    capturer.save_summary()


if __name__ == "__main__":
    print("\n" + "="*70)
    print("  COINPOKER FULL TRAFFIC CAPTURE")
    print("="*70)
    print()
    print("Capturing ALL CoinPoker API traffic...")
    print("Proxy: localhost:8080")
    print()
    print("Instructions:")
    print("  1. Start CoinPoker")
    print("  2. Login and play")
    print("  3. All traffic will be logged")
    print()
    print(f"Logs directory: {os.path.abspath(capturer.log_dir)}")
    print()
    print("Press Ctrl+C to stop and save")
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
        print("  CAPTURE STOPPED")
        print("="*70)
        capturer.save_summary()

