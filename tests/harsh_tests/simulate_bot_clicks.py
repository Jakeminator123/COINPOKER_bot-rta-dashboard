# test/simulate_bot_clicks.py
"""
Simulates bot detection WITHOUT needing hooks.
Directly triggers detection logic for testing GUI.
"""
import sys
import os
import time
import threading
from datetime import datetime

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.api import post_signal

class BotSimulator:
    def __init__(self):
        self.running = False
        self.click_count = 0
        
    def start(self):
        """Start simulating bot behaviour signals"""
        self.running = True
        print("\n🤖 BOT SIMULATION STARTED")
        print("-" * 40)
        
        # Simulate different detection scenarios
        scenarios = [
            self.simulate_synthetic_clicks,
            self.simulate_perfect_timing,
            self.simulate_automation_tool,
            self.simulate_suspicious_pattern,
            self.simulate_rta_behaviour
        ]
        
        for scenario in scenarios:
            if not self.running:
                break
            scenario()
            time.sleep(2)
        
        print("\n✅ Simulation complete!")
        print(f"Total signals sent: {self.click_count}")
        
    def simulate_synthetic_clicks(self):
        """Simulate detection of synthetic/injected clicks"""
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Simulating: Synthetic clicks")
        
        # First, low suspicion
        post_signal("behaviour", "Unusual Click Pattern", "INFO", 
                   "Score: 25 - Synthetic: 15% | Movement detected")
        self.click_count += 1
        time.sleep(3)
        
        # Then escalate
        post_signal("behaviour", "Suspicious Clicking", "WARN",
                   "Score: 45 - Synthetic: 55% | No movement: 60%")
        self.click_count += 1
        time.sleep(3)
        
        # Finally, full detection
        post_signal("behaviour", "Bot Clicking Detected", "ALERT",
                   "Score: 85 - Synthetic: 100% | No movement: 95% | Center-click: 1.2px")
        self.click_count += 1
        print("  → Sent: Bot detection (RED ALERT)")
        
    def simulate_perfect_timing(self):
        """Simulate perfect timing pattern detection"""
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Simulating: Perfect timing")
        
        post_signal("behaviour", "Bot Timing Detected", "ALERT",
                   "Robotic timing: 12ms variance | Perfect streak: 25 actions")
        self.click_count += 1
        print("  → Sent: Timing detection (RED ALERT)")
        
    def simulate_automation_tool(self):
        """Simulate automation tool detection"""
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Simulating: Automation tool")
        
        # Python detected
        post_signal("behaviour", "Automation Tool: python.exe", "WARN",
                   "156 inputs in last 30s [IL: Low]")
        self.click_count += 1
        time.sleep(2)
        
        # Synthetic from Python
        post_signal("behaviour", "Synthetic Input from python.exe", "ALERT",
                   "⚠️ SYNTHETIC INPUT: 100% from python.exe")
        self.click_count += 1
        print("  → Sent: Automation tool (YELLOW WARN + RED ALERT)")
        
    def simulate_suspicious_pattern(self):
        """Simulate suspicious but not confirmed bot pattern"""
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Simulating: Suspicious patterns")
        
        post_signal("behaviour", "Suspicious Input Patterns", "WARN",
                   "Score: 52 - Multiple anomalies detected")
        self.click_count += 1
        
        time.sleep(2)
        
        post_signal("behaviour", "Click Source: TestBot.exe", "INFO",
                   "247 clicks in last 30s")
        self.click_count += 1
        print("  → Sent: Suspicious patterns (YELLOW WARN + BLUE INFO)")
        
    def simulate_rta_behaviour(self):
        """Simulate RTA (Real-Time Assistance) pattern"""
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Simulating: RTA behaviour")
        
        post_signal("behaviour", "Suspicious Timing", "WARN",
                   "RTA pattern: Alt-tab→750ms→action | Periodic: every 1200ms")
        self.click_count += 1
        
        time.sleep(2)
        
        post_signal("behaviour", "Multiple Input Sources", "WARN",
                   "Input from 3 processes: chrome.exe, python.exe, notepad.exe")
        self.click_count += 1
        print("  → Sent: RTA patterns (2x YELLOW WARN)")

def main():
    print("=" * 50)
    print("🎯 BEHAVIOUR DETECTION SIMULATOR")
    print("=" * 50)
    print("\nThis simulates bot detection WITHOUT hooks!")
    print("Perfect for testing when hooks are blocked.\n")
    
    print("⚠️  Make sure panel.py is running first!")
    print("    Watch the 'Behaviour' section in the GUI")
    print("=" * 50)
    
    input("\nPress ENTER to start simulation...")
    
    sim = BotSimulator()
    sim.start()
    
    print("\n" + "=" * 50)
    print("DONE! Check the Behaviour section in panel.py")
    print("You should see multiple colored alerts:")
    print("  🔴 RED = Bot detected")
    print("  🟡 YELLOW = Suspicious")
    print("  🔵 BLUE = Information")
    print("=" * 50)

if __name__ == "__main__":
    main()
