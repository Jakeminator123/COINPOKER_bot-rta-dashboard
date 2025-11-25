"""
MITM Certificate Detector
=========================
Detects suspicious MITM/proxy CA certificates in Windows certificate store.

These certificates could indicate:
- Traffic interception tools (mitmproxy, Burp Suite, Fiddler, Charles)
- Corporate SSL inspection (Zscaler, Blue Coat, Fortinet)
- Malware that installs root CAs to intercept HTTPS traffic

Detection is CRITICAL because:
- Someone could be intercepting poker client traffic
- Login credentials could be captured
- Game data could be manipulated
"""

import subprocess
import time
from typing import Any

from core.api import BaseSegment, post_signal
from utils.config_loader import get_config
from utils.runtime_flags import apply_cooldown


class MITMDetector(BaseSegment):
    """Detects MITM/proxy certificates in Windows certificate store."""

    name = "MITMDetector"
    category = "security"
    interval_s = 92.0  # Synchronized with unified batch interval

    # Default suspicious keywords (can be overridden by config)
    DEFAULT_SUSPICIOUS_KEYWORDS = [
        # Proxy/interception tools
        "mitmproxy",
        "burp",
        "portswigger",
        "fiddler",
        "charles",
        "wireshark",
        "httptoolkit",
        # Corporate SSL inspection
        "zscaler",
        "blue coat",
        "bluecoat",
        "fortinet",
        "fortigate",
        "checkpoint",
        "palo alto",
        "netskope",
        "websense",
        "symantec web",
        "mcafee web",
        "sophos",
        "barracuda",
        # Generic inspection terms
        "ssl inspection",
        "tls inspection",
        "deep inspection",
        "traffic inspection",
        "web filter",
        "content filter",
        # Malware-related
        "superfish",
        "komodia",
        "privdog",
    ]

    # Certificate stores to check
    STORES = ["root", "ca"]
    
    # Contexts: user and machine level
    CONTEXTS = {
        "user": ["-user"],
        "machine": [],
    }

    def __init__(self):
        super().__init__()
        
        # Load configuration
        self.config = get_config("security_config") or {}
        mitm_config = self.config.get("mitm_detection", {})
        
        # Get keywords from config or use defaults
        self.suspicious_keywords = mitm_config.get(
            "suspicious_keywords", 
            self.DEFAULT_SUSPICIOUS_KEYWORDS
        )
        # Normalize to lowercase for matching
        self.suspicious_keywords = [kw.lower() for kw in self.suspicious_keywords]
        
        # Get stores and contexts from config
        self.stores = mitm_config.get("certificate_stores", self.STORES)
        
        # Detection points from config
        detection_points = self.config.get("detection_points", {})
        self.points_critical = detection_points.get("mitm_tool_detected", 15)
        self.points_corporate = detection_points.get("corporate_inspection", 10)
        self.points_suspicious = detection_points.get("suspicious_certificate", 5)
        
        # Cooldown settings
        self._report_cooldown = apply_cooldown(
            mitm_config.get("report_cooldown", 300.0)  # 5 min default
        )
        self._last_reports: dict[str, float] = {}  # Track last report time per cert hash
        
        # Cache for detected certificates (avoid re-scanning same certs)
        self._known_certs: set[str] = set()
        self._last_full_scan = 0.0
        self._full_scan_interval = apply_cooldown(
            mitm_config.get("full_scan_interval", 600.0)  # 10 min default
        )
        
        print(f"[{self.name}] Initialized with {len(self.suspicious_keywords)} suspicious keywords")
        print(f"[{self.name}] Checking stores: {self.stores}")

    def _run_certutil(self, store: str, context_name: str) -> str:
        """Run certutil and return raw text output."""
        args = ["certutil", "-store"] + self.CONTEXTS.get(context_name, []) + [store]
        try:
            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                errors="ignore",
                timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
            )
        except FileNotFoundError:
            # certutil not found - Windows only
            return ""
        except subprocess.TimeoutExpired:
            print(f"[{self.name}] WARNING: certutil timed out for {context_name}/{store}")
            return ""
        except Exception as e:
            print(f"[{self.name}] ERROR: certutil failed: {e}")
            return ""

        if result.returncode != 0:
            # Store might be empty or inaccessible
            return ""

        return result.stdout or ""

    def _parse_certificate_block(self, block: str) -> dict[str, str]:
        """Parse a certificate block from certutil output."""
        lines = [line.strip() for line in block.splitlines()]
        
        cert_info = {
            "subject": "",
            "issuer": "",
            "hash": "",
            "serial": "",
            "not_before": "",
            "not_after": "",
        }
        
        for line in lines:
            if line.startswith("Subject:"):
                cert_info["subject"] = line[8:].strip()
            elif line.startswith("Issuer:"):
                cert_info["issuer"] = line[7:].strip()
            elif "Cert Hash" in line and "sha1" in line.lower():
                # Extract SHA1 hash
                parts = line.split(":")
                if len(parts) >= 2:
                    cert_info["hash"] = parts[-1].strip().replace(" ", "")
            elif line.startswith("Serial Number:"):
                cert_info["serial"] = line[14:].strip()
            elif line.startswith("NotBefore:"):
                cert_info["not_before"] = line[10:].strip()
            elif line.startswith("NotAfter:"):
                cert_info["not_after"] = line[9:].strip()
        
        return cert_info

    def _categorize_certificate(self, cert_info: dict[str, str], matched_keywords: list[str]) -> tuple[str, int, str]:
        """
        Categorize a suspicious certificate and return (status, points, category).
        
        Returns:
            Tuple of (status, points, category_name)
        """
        subject_lower = cert_info.get("subject", "").lower()
        issuer_lower = cert_info.get("issuer", "").lower()
        combined = subject_lower + " " + issuer_lower
        
        # Check for known MITM tools (CRITICAL)
        mitm_tools = ["mitmproxy", "burp", "portswigger", "fiddler", "charles", 
                      "httptoolkit", "wireshark", "superfish", "komodia", "privdog"]
        for tool in mitm_tools:
            if tool in combined or tool in matched_keywords:
                return "CRITICAL", self.points_critical, "MITM Tool"
        
        # Check for corporate SSL inspection (ALERT)
        corporate_tools = ["zscaler", "blue coat", "bluecoat", "fortinet", "fortigate",
                          "checkpoint", "palo alto", "netskope", "websense", 
                          "symantec web", "mcafee web", "sophos", "barracuda"]
        for tool in corporate_tools:
            if tool in combined or tool in matched_keywords:
                return "ALERT", self.points_corporate, "Corporate SSL Inspection"
        
        # Generic suspicious (WARN)
        return "WARN", self.points_suspicious, "Suspicious Certificate"

    def _scan_store(self, store: str, context_name: str) -> list[dict[str, Any]]:
        """Scan a certificate store for suspicious certificates."""
        findings = []
        
        output = self._run_certutil(store, context_name)
        if not output:
            return findings
        
        # Split by certificate separator
        blocks = output.split("===============")
        
        for block in blocks:
            if not block.strip():
                continue
            
            block_lower = block.lower()
            
            # Check for suspicious keywords
            matched_keywords = [kw for kw in self.suspicious_keywords if kw in block_lower]
            if not matched_keywords:
                continue
            
            # Parse certificate info
            cert_info = self._parse_certificate_block(block)
            
            # Skip if no subject (invalid block)
            if not cert_info.get("subject"):
                continue
            
            # Categorize the finding
            status, points, category = self._categorize_certificate(cert_info, matched_keywords)
            
            findings.append({
                "store": store,
                "context": context_name,
                "cert_info": cert_info,
                "matched_keywords": matched_keywords,
                "status": status,
                "points": points,
                "category": category,
            })
        
        return findings

    def _should_report(self, cert_hash: str) -> bool:
        """Check if we should report this certificate (cooldown check)."""
        if not cert_hash:
            return True
        
        now = time.time()
        last_report = self._last_reports.get(cert_hash, 0)
        
        if now - last_report < self._report_cooldown:
            return False
        
        return True

    def _report_finding(self, finding: dict[str, Any]) -> None:
        """Report a suspicious certificate finding."""
        cert_info = finding["cert_info"]
        cert_hash = cert_info.get("hash", "")
        
        # Check cooldown
        if not self._should_report(cert_hash):
            return
        
        # Update last report time
        self._last_reports[cert_hash] = time.time()
        
        # Build details string
        details_parts = [
            f"Category: {finding['category']}",
            f"Store: {finding['context']}/{finding['store']}",
            f"Subject: {cert_info.get('subject', 'Unknown')}",
            f"Issuer: {cert_info.get('issuer', 'Unknown')}",
        ]
        
        if cert_hash:
            details_parts.append(f"SHA1: {cert_hash}")
        
        if finding["matched_keywords"]:
            details_parts.append(f"Matched: {', '.join(finding['matched_keywords'][:5])}")
        
        details = " | ".join(details_parts)
        
        # Determine signal name based on category
        if finding["category"] == "MITM Tool":
            name = "MITM Proxy Certificate Detected"
        elif finding["category"] == "Corporate SSL Inspection":
            name = "SSL Inspection Certificate Detected"
        else:
            name = "Suspicious Root Certificate"
        
        post_signal(
            category=self.category,
            name=name,
            status=finding["status"],
            details=details,
        )
        
        print(f"[{self.name}] {finding['status']}: {name} - {cert_info.get('subject', 'Unknown')[:50]}")

    def tick(self):
        """Main detection loop - scan certificate stores."""
        now = time.time()
        
        # Check if we need a full scan or incremental
        do_full_scan = (now - self._last_full_scan) >= self._full_scan_interval
        
        all_findings = []
        
        for store in self.stores:
            for context_name in self.CONTEXTS:
                try:
                    findings = self._scan_store(store, context_name)
                    all_findings.extend(findings)
                except Exception as e:
                    print(f"[{self.name}] ERROR scanning {context_name}/{store}: {e}")
        
        if do_full_scan:
            self._last_full_scan = now
            # Clear known certs cache on full scan to re-report if still present
            self._known_certs.clear()
        
        # Report findings
        for finding in all_findings:
            cert_hash = finding["cert_info"].get("hash", "")
            
            # Skip if already known (unless full scan)
            if cert_hash and cert_hash in self._known_certs and not do_full_scan:
                continue
            
            # Add to known certs
            if cert_hash:
                self._known_certs.add(cert_hash)
            
            # Report the finding
            self._report_finding(finding)
        
        # Log summary if any findings
        if all_findings and do_full_scan:
            critical_count = sum(1 for f in all_findings if f["status"] == "CRITICAL")
            alert_count = sum(1 for f in all_findings if f["status"] == "ALERT")
            warn_count = sum(1 for f in all_findings if f["status"] == "WARN")
            print(f"[{self.name}] Scan complete: {critical_count} CRITICAL, {alert_count} ALERT, {warn_count} WARN")

    def cleanup(self):
        """Cleanup resources."""
        self._known_certs.clear()
        self._last_reports.clear()

