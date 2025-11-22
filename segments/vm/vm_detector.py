# segments/vm/vm_detector.py
"""
Virtual Machine detection segment with heuristic probability scoring.
Detects VMs, containers, and virtualization software that could be used to run bots.
Enhanced with CPUID, WMI, and hardware fingerprinting for probability calculation.
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes
import math
import platform
import time
from typing import Any

import psutil  # type: ignore

# Optional Windows registry access
try:
    import winreg  # type: ignore
except Exception:
    winreg = None  # type: ignore

# Optional WMI support
try:
    import wmi as wmi_module  # type: ignore
except ImportError:
    wmi_module = None

from core.api import BaseSegment, post_signal
from utils.config_loader import get_config
from utils.detection_keepalive import DetectionKeepalive
from utils.runtime_flags import apply_cooldown


# Load configuration
def _load_vm_config():
    """Load VM configuration from config_loader (dashboard/cache/local)"""
    try:
        config = get_config("vm_config")
        if config:
            return config
    except Exception as e:
        print(f"[VMDetector] WARNING: Config load failed: {e}")

    # Return minimal defaults
    return {
        "vm_processes": {},
        "vm_manufacturers": [],
        "vm_models": [],
        "vm_mac_prefixes": [],
        "vm_registry_markers": [],
        "known_hv_vendors": {},
        "evidence_weights": {},
        "detection_settings": {"interval_seconds": 30.0},
        "poker_monitoring": {},
    }


_config = _load_vm_config()


# Load shared configuration
def _load_shared_config():
    """Load shared configuration from config_loader"""
    try:
        config = get_config("shared_config")
        if config:
            return config
    except Exception as e:
        print(f"[VMDetector] WARNING: Shared config load failed: {e}")

    return {}


_shared_config = _load_shared_config()


class VMDetector(BaseSegment):
    """
    Enhanced VM detection with probability scoring.
    Uses multiple signals to calculate likelihood of running in a VM.
    """

    name = "VMDetector"
    category = "vm"
    interval_s = 92.0  # Align with unified batch cadence

    def __init__(self):
        super().__init__()

        # Load configuration
        detection_config = _config.get("detection_settings", {})
        self.interval_s = detection_config.get("interval_seconds", 92.0)
        self._report_cooldown = apply_cooldown(detection_config.get("report_cooldown", 60.0))
        self._full_check_interval = apply_cooldown(detection_config.get("full_check_interval", 300.0))

        # Load thresholds
        self._high_threshold = detection_config.get("high_probability_threshold", 80)
        self._medium_threshold = detection_config.get("medium_probability_threshold", 55)
        self._low_threshold = detection_config.get("low_probability_threshold", 35)

        # Load logistic function parameters
        self._logistic_center = detection_config.get("logistic_center", 50.0)
        self._logistic_slope = detection_config.get("logistic_slope", 12.0)

        self._last_report: dict[str, float] = {}

        # Previous detection state
        self._last_vm_probability = 0.0
        self._last_full_check = 0.0

        keepalive_seconds = float(detection_config.get("keepalive_seconds", 60.0))
        keepalive_seconds = max(15.0, min(keepalive_seconds, 60.0))
        active_timeout = float(detection_config.get("keepalive_active_timeout", 180.0))
        if active_timeout < keepalive_seconds * 2:
            active_timeout = keepalive_seconds * 2
        self._keepalive = DetectionKeepalive(
            "vm",
            keepalive_interval=keepalive_seconds,
            active_timeout=active_timeout,
        )

        # Load VM processes from config
        self.vm_processes = {}
        vm_processes_config = _config.get("vm_processes", {})
        for category, processes in vm_processes_config.items():
            self.vm_processes.update(processes)

        # Load VM indicators from config
        self.vm_manufacturers = _config.get("vm_manufacturers", [])
        self.vm_models = _config.get("vm_models", [])
        self.vm_mac_prefixes = _config.get("vm_mac_prefixes", [])

        # Load registry markers from config
        self.vm_registry_markers = []
        if winreg is not None and platform.system() == "Windows":
            registry_config = _config.get("vm_registry_markers", [])
            for marker in registry_config:
                root_str = marker.get("root", "HKEY_LOCAL_MACHINE")
                root_key = getattr(winreg, root_str, winreg.HKEY_LOCAL_MACHINE)
                self.vm_registry_markers.append(
                    (root_key, marker.get("path", ""), marker.get("label", ""))
                )

        # Load hypervisor vendors and weights from config
        hv_vendors_config = _config.get("known_hv_vendors", {})
        self.known_hv_vendors = {k.encode(): v for k, v in hv_vendors_config.items()}

        # Load evidence weights from config
        self.weights = _config.get("evidence_weights", {})

        # Load poker monitoring settings from shared config
        poker_config = _shared_config.get("poker_sites", {})
        protected = poker_config.get("protected", {})
        self.protected_poker_process = protected.get("process", "game.exe")
        self.protected_poker_path_hint = protected.get("path_hint", "coinpoker")
        self.other_poker_processes = poker_config.get("other", [])

        print(f"[VMDetector] Loaded {len(self.vm_processes)} VM processes from config")
        print(f"[VMDetector] Ready with {len(self.vm_registry_markers)} registry markers")

    def tick(self):
        """Main detection loop"""
        now = time.time()

        # Quick process check every tick
        self._detect_vm_processes()

        # Full VM detection periodically
        if now - self._last_full_check >= self._full_check_interval:
            self._last_full_check = now
            self._perform_full_vm_detection()

        # Check for poker + VM combination
        self._check_poker_vm_combo()

        self._keepalive.emit_keepalives()

    def _detect_vm_processes(self):
        """Detect running VM software (quick check)"""
        try:
            for proc in psutil.process_iter(["pid", "name", "exe"]):
                proc_name = (proc.info.get("name") or "").lower()

                if proc_name in self.vm_processes:
                    vm_info = self.vm_processes[proc_name]
                    now = time.time()
                    alias = proc_name

                    # Check cooldown
                    if proc_name in self._last_report:
                        if now - self._last_report[proc_name] < self._report_cooldown:
                            self._keepalive.refresh_alias(alias)
                            continue

                    # Read points from config (no fallback to risk)
                    points = vm_info.get("points")

                    if points is None:
                        print(f"[VMDetector] CRITICAL ERROR: Missing 'points' for {proc_name}")
                        continue

                    try:
                        points = int(points)
                    except Exception:
                        print(
                            f"[VMDetector] CRITICAL ERROR: Invalid 'points' for {proc_name}: {points}"
                        )
                        continue

                    # Map points -> status using 15/10/5/0 thresholds
                    if points >= 15:
                        status = "CRITICAL"
                        detail = "Active VM/Guest tools running"
                    elif points >= 10:
                        status = "ALERT"
                        detail = "VM software detected"
                    elif points >= 5:
                        status = "WARN"
                        detail = "VM component running"
                    else:
                        status = "INFO"
                        detail = "VM component detected"

                    post_signal("vm", vm_info["name"], status, detail)
                    self._last_report[proc_name] = now
                    detection_key = f"vmproc:{proc_name}:{status}"
                    self._keepalive.mark_active(
                        detection_key,
                        vm_info["name"],
                        status,
                        detail,
                        alias=alias,
                    )

        except Exception:
            pass

    def _perform_full_vm_detection(self):
        """Perform comprehensive VM detection with probability scoring"""
        evidence = self._collect_all_evidence()

        # Calculate probability
        raw_score = evidence["score_points"]
        probability = self._score_to_probability(raw_score)

        # Determine verdict using config thresholds (4 levels)
        if probability >= self._high_threshold:
            verdict = "Very High likelihood: Virtual Machine"
        elif probability >= self._medium_threshold:
            verdict = "Likely VM"
        elif probability >= self._low_threshold:
            verdict = "Possibly VM"
        else:
            verdict = "Low VM probability"

        # Report if probability changed significantly or is high
        if (
            abs(probability - self._last_vm_probability) >= 10
            or probability >= self._medium_threshold
        ):
            self._emit_vm_detection(probability, verdict, evidence)
            self._last_vm_probability = probability

    def _collect_all_evidence(self) -> dict[str, Any]:
        """Collect all VM evidence and calculate score"""
        evidences = []
        total_score = 0

        # WMI checks (if available)
        if wmi_module:
            wmi_evidence, wmi_score = self._check_wmi()
            evidences.extend(wmi_evidence)
            total_score += wmi_score

        # Process checks (guest tools)
        proc_evidence, proc_score = self._check_guest_processes()
        evidences.extend(proc_evidence)
        total_score += proc_score

        # Registry checks
        reg_evidence, reg_score = self._check_registry()
        evidences.extend(reg_evidence)
        total_score += reg_score

        # MAC address checks
        mac_evidence, mac_score = self._check_mac_addresses()
        evidences.extend(mac_evidence)
        total_score += mac_score

        # CPUID checks (x64 only)
        if platform.machine().lower() in ("amd64", "x86_64"):
            cpuid_evidence, cpuid_score = self._check_cpuid()
            evidences.extend(cpuid_evidence)
            total_score += cpuid_score

        return {
            "os": f"{platform.system()} {platform.release()}",
            "score_points": total_score,
            "evidences": evidences,
        }

    def _check_wmi(self) -> tuple:
        """Check WMI for VM indicators"""
        evidences = []
        score = 0

        try:
            c = wmi_module.WMI()

            # Computer System
            cs = c.Win32_ComputerSystem()[0]
            manufacturer = (getattr(cs, "Manufacturer", "") or "").lower()
            model = (getattr(cs, "Model", "") or "").lower()
            hypervisor_present = getattr(cs, "HypervisorPresent", None)

            if any(vm in manufacturer for vm in self.vm_manufacturers):
                evidences.append(
                    {
                        "name": "manufacturer_vm",
                        "weight": self.weights["manufacturer_vm"],
                        "reason": f"Manufacturer suggests VM: '{cs.Manufacturer}'",
                    }
                )
                score += self.weights["manufacturer_vm"]

            if any(vm in model for vm in self.vm_models):
                evidences.append(
                    {
                        "name": "model_vm",
                        "weight": self.weights["model_vm"],
                        "reason": f"Model suggests VM: '{cs.Model}'",
                    }
                )
                score += self.weights["model_vm"]

            if hypervisor_present is True:
                evidences.append(
                    {
                        "name": "wmi_hypervisor_present",
                        "weight": self.weights["wmi_hypervisor_present"],
                        "reason": "WMI reports HypervisorPresent=True",
                    }
                )
                score += self.weights["wmi_hypervisor_present"]

            # BIOS
            bios = c.Win32_BIOS()[0]
            bios_serial = (getattr(bios, "SerialNumber", "") or "").lower()
            bios_version = (getattr(bios, "SMBIOSBIOSVersion", "") or "").lower()

            bios_str = f"{bios_serial} {bios_version}"
            if any(vm in bios_str for vm in self.vm_models + self.vm_manufacturers):
                evidences.append(
                    {
                        "name": "bios_vm",
                        "weight": self.weights["bios_vm"],
                        "reason": "BIOS/SMBIOS strings include VM markers",
                    }
                )
                score += self.weights["bios_vm"]

            # Disk drives
            disks = c.Win32_DiskDrive()
            disk_hits = 0
            for disk in disks:
                model = (getattr(disk, "Model", "") or "").lower()
                if any(vm in model for vm in self.vm_models + ["vmware", "vbox", "virtual"]):
                    disk_hits += 1

            if disk_hits > 0:
                add = min(
                    disk_hits * self.weights["disk_vm_each"],
                    self.weights["disk_vm_cap"],
                )
                evidences.append(
                    {
                        "name": "disk_vm",
                        "weight": add,
                        "reason": f"{disk_hits} disk(s) have virtual model names",
                    }
                )
                score += add

            # Video controller
            videos = c.Win32_VideoController()
            for video in videos:
                name = (getattr(video, "Name", "") or "").lower()
                if any(
                    vm in name for vm in self.vm_models + ["svga", "vmware", "virtualbox", "qxl"]
                ):
                    evidences.append(
                        {
                            "name": "video_vm",
                            "weight": self.weights["video_vm"],
                            "reason": f"Video controller suggests VM: '{video.Name}'",
                        }
                    )
                    score += self.weights["video_vm"]
                    break

        except Exception as e:
            evidences.append({"name": "wmi_error", "weight": 0, "reason": f"WMI error: {str(e)}"})

        return evidences, score

    def _check_guest_processes(self) -> tuple:
        """Check for VM guest tools/services"""
        evidences = []
        score = 0

        guest_tools = {
            "vmtoolsd.exe",
            "vmwaretray.exe",
            "vmwareuser.exe",
            "vboxservice.exe",
            "vboxtray.exe",
            "qemu-ga.exe",
            "prl_tools.exe",
            "prl_tools_service.exe",
        }

        try:
            running = {
                (p.info.get("name") or "").lower() for p in psutil.process_iter(attrs=["name"])
            }
            found = sorted(guest_tools & running)

            if found:
                evidences.append(
                    {
                        "name": "guest_tools",
                        "weight": self.weights["guest_tools"],
                        "reason": f"VM guest tools detected: {', '.join(found)}",
                    }
                )
                score += self.weights["guest_tools"]

        except Exception:
            pass

        return evidences, score

    def _check_registry(self) -> tuple:
        """Check registry for VM markers"""
        evidences = []
        score = 0

        for root, path, label in self.vm_registry_markers:
            try:
                with winreg.OpenKey(root, path):
                    evidences.append(
                        {
                            "name": f"reg_vm:{label}",
                            "weight": self.weights["reg_vm_each"],
                            "reason": f"Registry marker found: {label}",
                        }
                    )
                    score += self.weights["reg_vm_each"]
            except OSError:
                continue

        return evidences, score

    def _check_mac_addresses(self) -> tuple:
        """Check network adapter MAC addresses"""
        evidences = []
        score = 0

        try:
            mac_hits = 0
            for nic, addrs in psutil.net_if_addrs().items():
                for addr in addrs:
                    if getattr(addr, "family", None) == psutil.AF_LINK:
                        mac = (addr.address or "").upper().replace("-", ":")
                        if len(mac) >= 17:
                            prefix = mac[:8]
                            if any(
                                prefix.startswith(vm_prefix.upper())
                                for vm_prefix in self.vm_mac_prefixes
                            ):
                                mac_hits += 1

            if mac_hits > 0:
                add = min(mac_hits * self.weights["mac_vm_each"], self.weights["mac_vm_cap"])
                evidences.append(
                    {
                        "name": "mac_vm",
                        "weight": add,
                        "reason": f"{mac_hits} NIC(s) have VM vendor MAC prefix",
                    }
                )
                score += add

        except Exception:
            pass

        return evidences, score

    def _check_cpuid(self) -> tuple:
        """Check CPUID for hypervisor presence"""
        evidences = []
        score = 0

        try:
            # Check hypervisor bit
            eax, ebx, ecx, edx = self._cpuid(0x1)
            hypervisor_bit = bool(ecx & (1 << 31))

            if hypervisor_bit:
                # Try to get hypervisor vendor
                eax, ebx, ecx, edx = self._cpuid(0x40000000)
                vendor_raw = (
                    ebx.to_bytes(4, "little")
                    + ecx.to_bytes(4, "little")
                    + edx.to_bytes(4, "little")
                )

                vendor_name = None
                for known_vendor, name in self.known_hv_vendors.items():
                    if vendor_raw.startswith(known_vendor.rstrip(b"\0")):
                        vendor_name = name
                        break

                if vendor_name:
                    evidences.append(
                        {
                            "name": "cpuid_hv_vendor",
                            "weight": self.weights["cpuid_hv_vendor"],
                            "reason": f"CPUID reports hypervisor: {vendor_name}",
                        }
                    )
                    score += self.weights["cpuid_hv_vendor"]
                else:
                    evidences.append(
                        {
                            "name": "cpuid_hv_bit_only",
                            "weight": self.weights["cpuid_hv_bit_only"],
                            "reason": "CPUID hypervisor bit set (could be Hyper-V on bare metal)",
                        }
                    )
                    score += self.weights["cpuid_hv_bit_only"]
            else:
                evidences.append(
                    {
                        "name": "cpuid_no_hv",
                        "weight": 0,
                        "reason": "CPUID hypervisor bit not set",
                    }
                )

        except Exception:
            evidences.append({"name": "cpuid_error", "weight": 0, "reason": "CPUID check failed"})

        return evidences, score

    def _cpuid(self, leaf: int) -> tuple:
        """Execute CPUID instruction (x64 only)"""
        # Minimal inline assembly for CPUID
        code = bytearray(
            [
                0x53,  # push rbx
                0x89,
                0xC8,  # mov eax, ecx
                0x31,
                0xC9,  # xor ecx, ecx
                0x0F,
                0xA2,  # cpuid
                0x89,
                0x02,  # mov [rdx], eax
                0x89,
                0x5A,
                0x04,  # mov [rdx+4], ebx
                0x89,
                0x4A,
                0x08,  # mov [rdx+8], ecx
                0x89,
                0x52,
                0x0C,  # mov [rdx+12], edx
                0x5B,  # pop rbx
                0xC3,  # ret
            ]
        )

        # Allocate executable memory
        size = len(code)
        MEM_COMMIT = 0x1000
        PAGE_EXECUTE_READWRITE = 0x40
        kernel32 = ctypes.windll.kernel32

        addr = kernel32.VirtualAlloc(None, size, MEM_COMMIT, PAGE_EXECUTE_READWRITE)
        if not addr:
            raise OSError("VirtualAlloc failed")

        try:
            # Copy code
            ctypes.memmove(addr, (ctypes.c_char * size).from_buffer(code), size)

            # Execute
            ftype = ctypes.CFUNCTYPE(None, ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32))
            func = ftype(addr)
            out = (ctypes.c_uint32 * 4)()
            func(leaf, out)

            return out[0], out[1], out[2], out[3]

        finally:
            kernel32.VirtualFree(addr, 0, 0x8000)  # MEM_RELEASE

    def _score_to_probability(self, raw_score: int) -> float:
        """Convert raw score to probability percentage using logistic function"""
        # Use config parameters for logistic function
        s = self._logistic_slope
        center = self._logistic_center
        pct = 100.0 * (1.0 / (1.0 + math.exp(-(raw_score - center) / s)))
        return round(max(0.0, min(100.0, pct)), 1)

    def _emit_vm_detection(self, probability: float, verdict: str, evidence: dict[str, Any]):
        """Emit VM detection signal - use 4 levels"""
        # Determine status based on config thresholds
        if probability >= self._high_threshold:
            status = "CRITICAL"
        elif probability >= self._medium_threshold:
            status = "ALERT"
        elif probability >= self._low_threshold:
            status = "WARN"
        else:
            status = "INFO"

        # Build details with top evidence
        details = f"{verdict} ({probability}%)"

        # Add top evidence reasons
        top_evidences = sorted(
            evidence["evidences"], key=lambda e: e.get("weight", 0), reverse=True
        )[:2]

        if top_evidences:
            reasons = " | ".join(e["reason"] for e in top_evidences)
            details += f" | {reasons}"

        post_signal("vm", "VM Detection", status, details)
        detection_key = f"vm_detection:{status}"
        self._keepalive.mark_active(
            detection_key,
            "VM Detection",
            status,
            details,
            alias="vm_detection",
        )

    def _check_poker_vm_combo(self):
        """Check for poker client + VM running together"""
        # Use config values for poker monitoring
        protected_poker_process = self.protected_poker_process
        protected_poker_path_hint = self.protected_poker_path_hint
        other_poker_processes = self.other_poker_processes
        vm_running = False
        protected_poker_running = False
        other_poker_running = False

        try:
            for proc in psutil.process_iter(["name", "exe"]):
                proc_name = (proc.info.get("name") or "").lower()
                proc_path = (proc.info.get("exe") or "").lower()

                # Check for VM
                if proc_name in self.vm_processes:
                    vm_running = True

                # Check for PROTECTED poker (CoinPoker/game.exe)
                if proc_name == protected_poker_process and protected_poker_path_hint in proc_path:
                    protected_poker_running = True

                # Check for other poker sites
                elif any(poker in proc_name for poker in other_poker_processes):
                    other_poker_running = True

            # Alert based on poker type
            if vm_running and protected_poker_running:
                now = time.time()
                if (
                    "coinpoker_vm_combo" not in self._last_report
                    or now - self._last_report["coinpoker_vm_combo"] > self._report_cooldown
                ):
                    post_signal(
                        "vm",
                        "CoinPoker + VM Active",
                        "CRITICAL",
                        "CoinPoker running with VM (protected site) - CRITICAL bot risk",
                    )
                    self._last_report["coinpoker_vm_combo"] = now
                    detection_key = "combo:coinpoker"
                    self._keepalive.mark_active(
                        detection_key,
                        "CoinPoker + VM Active",
                        "CRITICAL",
                        "CoinPoker running with VM (protected site) - CRITICAL bot risk",
                        alias="coinpoker_vm_combo",
                    )
                else:
                    self._keepalive.refresh_alias("coinpoker_vm_combo")

            elif vm_running and other_poker_running:
                now = time.time()
                if (
                    "other_poker_vm_combo" not in self._last_report
                    or now - self._last_report["other_poker_vm_combo"] > self._report_cooldown
                ):
                    post_signal(
                        "vm",
                        "Other Poker + VM Active",
                        "ALERT",
                        "Non-CoinPoker poker with VM",
                    )
                    self._last_report["other_poker_vm_combo"] = now
                    detection_key = "combo:other"
                    self._keepalive.mark_active(
                        detection_key,
                        "Other Poker + VM Active",
                        "ALERT",
                        "Non-CoinPoker poker with VM",
                        alias="other_poker_vm_combo",
                    )
                else:
                    self._keepalive.refresh_alias("other_poker_vm_combo")

        except Exception:
            pass
