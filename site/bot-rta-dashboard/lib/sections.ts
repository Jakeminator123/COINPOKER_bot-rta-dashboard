export type Status =
  | "CRITICAL"
  | "ALERT"
  | "WARN"
  | "INFO"
  | "OK"
  | "OFF"
  | "UNK";

export const STATUS_COLORS: Record<Status, string> = {
  CRITICAL: "#dc2626", // Red-600 - darkest red for critical
  ALERT: "#f97316", // Orange-500 - orange for alerts
  WARN: "#eab308", // Yellow-500 - yellow for warnings
  INFO: "#3b82f6", // Blue-500 - blue for info
  OK: "#22c55e", // Green-500
  OFF: "#6b7280", // Gray-500
  UNK: "#9ca3af", // Gray-400
};

export type Signal = {
  timestamp: number; // epoch seconds
  category: "programs" | "network" | "behaviour" | "vm" | "auto" | string;
  name: string; // e.g. 'HashScanner: SHA256 match'
  status: Status;
  details?: string;
  device_id?: string; // unique device/source identifier
  device_name?: string; // human-readable device name
  device_ip?: string; // source IP (if available)
  segment_name?: string; // name of segment that created this signal
};

export type Stored = Signal & {
  id: string;
  section: SectionKey;
  uniqueKey: string;
  firstSeen: number;
  confidence?: number; // Number of detection sources (1-5+)
  sources?: string[]; // Which segments detected this
  detections?: number; // Total detection count
};

export type SectionKey =
  | "programs_file_names"
  | "programs_sha_hashes"
  | "programs_window_titles"
  | "programs_path_hints"
  | "programs_obfuscation"
  | "network_browser_urls"
  | "network_messengers"
  | "network_connections"
  | "network_dns_queries"
  | "behaviour_mouse_patterns"
  | "behaviour_keyboard_patterns"
  | "behaviour_action_timing"
  | "behaviour_click_patterns"
  | "vm_vmware"
  | "vm_virtualbox"
  | "vm_hyperv"
  | "vm_other_vm"
  | "auto_macros"
  | "auto_scripts"
  | "auto_automation"
  | "auto_clickers"
  | "system_reports";

export const DETECTION_SECTIONS: Record<
  string,
  { title: string; subsections: Record<string, string> }
> = {
  programs: {
    title: "🖥️ Programs",
    subsections: {
      file_names: "Process Names",
      sha_hashes: "SHA-256 Hashes",
      window_titles: "Window Titles",
      path_hints: "Path Analysis",
      obfuscation: "Obfuscation",
    },
  },
  network: {
    title: "🌐 Network",
    subsections: {
      browser_urls: "Browser/RTA Sites",
      messengers: "Telegram/Discord",
      connections: "Active Connections",
      dns_queries: "DNS Lookups",
    },
  },
  behaviour: {
    title: "🎯 Behaviour",
    subsections: {
      mouse_patterns: "Mouse Patterns",
      keyboard_patterns: "Keyboard Input",
      action_timing: "Action Timing",
      click_patterns: "Click Analysis",
    },
  },
  vm: {
    title: "💻 Virtual Machines",
    subsections: {
      vmware: "VMware",
      virtualbox: "VirtualBox",
      hyperv: "Hyper-V/WSL",
      other_vm: "Other VMs",
    },
  },
  auto: {
    title: "⚙️ Script & Automation",
    subsections: {
      macros: "Macro Tools",
      scripts: "Scripting",
      automation: "Automation",
      clickers: "Auto-Clickers",
    },
  },
  // 'system' category intentionally omitted from UI categories
};

// Simple router similar to the desktop panel
export function routeToSectionKey(sig: Signal): SectionKey {
  const name = sig.name.toLowerCase();
  const details = (sig.details || "").toLowerCase();

  if (sig.category === "programs") {
    if (
      details.startsWith("sha:") ||
      details.includes("sha256") ||
      details.includes("sha=")
    )
      return "programs_sha_hashes";
    if (name.includes("window")) return "programs_window_titles";
    if (
      name.includes("entropy") ||
      name.includes("obfuscation") ||
      details.includes("packer")
    )
      return "programs_obfuscation";
    if (details.includes("path") || details.includes("\\"))
      return "programs_path_hints";
    return "programs_file_names";
  }

  if (sig.category === "network") {
    if (
      name.includes("gto") ||
      name.includes("wizard") ||
      name.includes("odin") ||
      name.includes("rta")
    )
      return "network_browser_urls";
    if (name.includes("dns")) return "network_dns_queries";
    if (name.includes("conn") || name.includes("socket"))
      return "network_connections";
    return "network_messengers";
  }

  if (sig.category === "behaviour") {
    if (name.includes("mouse")) return "behaviour_mouse_patterns";
    if (name.includes("key")) return "behaviour_keyboard_patterns";
    if (name.includes("click") || details.includes("click"))
      return "behaviour_click_patterns";
    if (name.includes("timing") || details.includes("timing"))
      return "behaviour_action_timing";
    return "behaviour_action_timing"; // Default for behaviour signals
  }

  if (sig.category === "vm") {
    if (name.includes("vmware")) return "vm_vmware";
    if (name.includes("virtualbox") || name.includes("vbox"))
      return "vm_virtualbox";
    if (name.includes("hyper") || name.includes("wsl")) return "vm_hyperv";
    return "vm_other_vm";
  }

  if (sig.category === "auto") {
    if (name.includes("macro") || name.includes("hotkey")) return "auto_macros";
    if (name.includes("python") || name.includes("node")) return "auto_scripts";
    if (name.includes("click")) return "auto_clickers";
    return "auto_automation";
  }

  // System signals (summaries, batch reports) - route to dedicated section
  if (sig.category === "system") {
    return "system_reports";
  }

  // default
  return "programs_file_names";
}
