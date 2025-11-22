import { Signal, SectionKey, routeToSectionKey, Stored } from "@/lib/detections/sections";
import {
  StorageAdapter,
  type AggregatePoint,
  type DeviceListEntry,
} from "./storage-adapter";
import { DEVICE_TIMEOUT_MS } from "./device-session";

// In-memory store with TTL for live detection signals
// For historical data and reporting, use a database instead

// ============================================================================
// TIME CONSTANTS (MS = Milliseconds)
// ============================================================================
// TTL_MS: Time To Live - how long signals are kept in memory before cleanup
// Signals older than this are automatically removed to prevent memory bloat
const TTL_MS = Number(process.env.MEMORY_STORE_TTL_MS) || (10 * 60 * 1000); // Default: 10 minutes (configurable via MEMORY_STORE_TTL_MS env var)

// MAX_ITEMS_PER_SECTION: Maximum signals kept per detection section (prevents memory overflow)
const MAX_ITEMS_PER_SECTION = Number(process.env.MAX_ITEMS_PER_SECTION) || 200; // Configurable via MAX_ITEMS_PER_SECTION env var

// SIGNAL_COOLDOWN_MS: Prevent duplicate signals within this time window
// Same detection from same source won't be stored again within cooldown period
const SIGNAL_COOLDOWN_MS = Number(process.env.SIGNAL_COOLDOWN_MS) || (30 * 1000); // Default: 30 seconds (configurable via SIGNAL_COOLDOWN_MS env var)

// ============================================================================
// MEMORY MANAGEMENT CONSTANTS
// ============================================================================
// MAX_DEVICES_IN_MEMORY: Maximum devices kept in memory to prevent memory bloat
// Performance optimization: Keep top N most active devices, remove older/offline devices
// Devices beyond this limit are removed during cleanup (but data still exists in Redis)
const MAX_DEVICES_IN_MEMORY = Number(process.env.MAX_DEVICES_IN_MEMORY) || 100; // Configurable via MAX_DEVICES_IN_MEMORY env var

// DEVICE_CLEANUP_INTERVAL_MS: How often to run device cleanup (remove stale devices)
const DEVICE_CLEANUP_INTERVAL_MS = Number(process.env.DEVICE_CLEANUP_INTERVAL_MS) || (5 * 60 * 1000); // Default: 5 minutes (configurable via DEVICE_CLEANUP_INTERVAL_MS env var)

// DEVICE_STALE_THRESHOLD_MS: Devices inactive for this long are considered stale and can be removed
// Only removed if not in top MAX_DEVICES_IN_MEMORY and offline/logged out
const DEVICE_STALE_THRESHOLD_MS = Number(process.env.DEVICE_STALE_THRESHOLD_MS) || (30 * 60 * 1000); // Default: 30 minutes (configurable via DEVICE_STALE_THRESHOLD_MS env var)

// Threat weights - 4-level system only
const THREAT_WEIGHTS = {
  CRITICAL: 15,
  ALERT: 10,
  WARN: 5,
  INFO: 0,
  OK: 0,
  OFF: 0,
  UNK: 0,
} as const;

function getThreatWeight(status: string): number {
  const key = status.toUpperCase() as keyof typeof THREAT_WEIGHTS;
  return THREAT_WEIGHTS[key] ?? 0;
}

function stripConfidenceTags(text: string): string {
  return (text || "")
    .replace(/\[\s*x\d+\s*\]/gi, "")
    .replace(/\[\s*confidence:\s*\dx\s*\]/gi, "")
    .replace(/confidence:\s*\dx/gi, "")
    .trim();
}

function extractArtifact(details: string): string {
  const d = (details || "").toLowerCase();

  // For WebMonitor: preserve "via=" information to distinguish different sources (browser vs DNS)
  const viaMatch = d.match(/via=([^,\s]+)/);
  if (viaMatch) {
    const via = viaMatch[1];
    // Extract base artifact without via
    const base = d.replace(/via=[^,\s]+/g, "").trim();
    return `${via}:${base.slice(0, 30)}`;
  }

  const procMatch = d.match(/proc[=:]\s*([a-z0-9_.-]+\.exe)\b/);
  if (procMatch) return procMatch[1];

  const fileMatch = d.match(/([a-z0-9._-]+\.(?:py|ahk|exe|bat|ps1|js|jar))/i);
  if (fileMatch) return fileMatch[1].toLowerCase();

  const stable = d
    .replace(/\b(pid|port|sha(?:256)?|ms|score|conns?)[:=]?\s*[\w.-]+/gi, "")
    .replace(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return stable.slice(0, 40);
}

function normalizeDetailsForKey(details?: string): string {
  const noConf = stripConfidenceTags(details || "");
  return extractArtifact(noConf);
}

function formatDetailsWithCount(
  details: string | undefined,
  count: number
): string {
  const base = stripConfidenceTags(details || "").trim();
  if (count <= 1) return base;
  return `${base} [x${count}]`;
}

export class MemoryStore implements StorageAdapter {
  private store: Map<SectionKey, Stored[]> = new Map();
  private devices: Map<
    string,
    {
      device_id: string;
      device_name: string;
      last_seen: number;
      signal_count: number;
      unique_detection_count: number;
      historical_threat_levels: number[]; // Historical threat levels
      session_start: number; // When player session started
      threat_score: number; // Accumulated threat points (HIGH=15, MEDIUM=10, SMALL=5)
      logged_out: boolean; // Whether player is currently logged out
      session_end: number; // When player session ended (if logged out)
      ip_address?: string; // Device IP address
    }
  > = new Map();
  private recentSignals: Map<string, number> = new Map();
  private lastSeq = 0;
  private lastDeviceCleanup = 0;

  /**
   * Check for login/logout events based on heartbeat timeout
   */
  private _checkSessionEvents(
    device_id: string,
    device_name: string,
    now: number,
    existing:
      | {
          device_id: string;
          device_name: string;
          last_seen: number;
          signal_count: number;
          unique_detection_count: number;
          historical_threat_levels: number[];
          session_start: number;
          threat_score: number;
          logged_out: boolean;
          session_end: number;
        }
      | undefined
  ): void {
    if (!existing) {
      // New device - start session
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Store] Session START for device ${device_id}`);
      }
      return;
    }

    const timeSinceLastSeen = now - existing.last_seen;
    const wasLoggedOut = existing.logged_out;

    // If device was previously logged out and now sending signals again, it's a login
    if (wasLoggedOut && existing.last_seen > 0) {
      // Device logged back in - start new session
      const loginDeviceData = this.devices.get(device_id);
      if (loginDeviceData) {
        loginDeviceData.session_start = now;
        loginDeviceData.logged_out = false;
        loginDeviceData.session_end = 0;
        this.devices.set(device_id, loginDeviceData);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Store] Session START for device ${device_id}`);
        }
      }
    }

    // If no heartbeat for > 5 minutes and device was active, it's a logout
    if (
      !wasLoggedOut &&
      existing.last_seen > 0 &&
      timeSinceLastSeen > DEVICE_TIMEOUT_MS &&
      existing.session_end === 0
    ) {
      const sessionDuration = now - existing.session_start;
      const logoutDeviceData = this.devices.get(device_id);

      if (logoutDeviceData) {
        logoutDeviceData.logged_out = true;
        logoutDeviceData.session_end = now;
        this.devices.set(device_id, logoutDeviceData);
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `[Store] Session END for device ${device_id} (duration: ${Math.floor(
              sessionDuration / 1000
            )}s)`
          );
        }
      }
    }
  }

  // Device snapshot cache for instant loading (top 20 devices)
  private deviceSnapshotCache: Map<
    string,
    {
      snapshot: {
        serverTime: number;
        sections: Record<string, { items: Stored[] }>;
      };
      cachedAt: number;
    }
  > = new Map();

  // Devices list cache for instant homepage loading
  private devicesListCache:
    | {
        devices: DeviceListEntry[];
        total: number;
        cachedAt: number;
      }
    | null = null;

  // Hourly aggregation data
  private hourlyAggregates: Map<string, AggregatePoint[]> = new Map();

  private readonly consolidationMeta = new WeakMap<
    Stored,
    { section: SectionKey; index: number }
  >();

  private readonly segmentsTemplate = (): AggregatePoint["segments"] => ({
    programs: { critical: 0, alert: 0, warn: 0, total_points: 0 },
    network: { critical: 0, alert: 0, warn: 0, total_points: 0 },
    behaviour: { critical: 0, alert: 0, warn: 0, total_points: 0 },
    vm: { critical: 0, alert: 0, warn: 0, total_points: 0 },
    auto: { critical: 0, alert: 0, warn: 0, total_points: 0 },
    screen: { critical: 0, alert: 0, warn: 0, total_points: 0 },
    system_reports: { critical: 0, alert: 0, warn: 0, total_points: 0 },
  });

  // Helper to extract normalized program name from signal
  // Used for consolidating same program from different categories (programs vs auto)
  /**
   * Extracts a stable program identifier from a signal.
   *
   * Goal:
   *   - Collapse "Suspicious Code: weatherzeroservice.exe" + "Suspicious Entropy: weatherzeroservice.exe"
   *     into the same uniqueKey so deduped scoring matches backend bot_probability.
   *
   * Strategy (in priority order):
   *   1. Parse explicit `proc=` hints inside details (most reliable).
   *   2. Parse filenames inside details (hash/process monitors often emit them).
   *   3. Parse filenames directly from the signal name (common with Suspicious Code/Entropy entries).
   *   4. Normalize descriptive titles by stripping prefixes/suffixes and take the last token after ':' or '-'.
   *   5. Fall back to alias tables ("pwsh" → "powershell") while ignoring generic words ("process", "script").
   *
   * Returns:
   *   - Normalized lowercase identifier (without extension) or null if nothing usable was found.
   */
  private extractProgramName(sig: Signal): string | null {
    const nameLower = (sig.name || "").toLowerCase().trim();
    const detailsLower = (sig.details || "").toLowerCase();

    // Try to extract executable name from details (proc=openholdem.exe)
    const procMatch = detailsLower.match(/proc[=:]\s*([a-z0-9_.-]+\.exe)\b/);
    if (procMatch) {
      const exeName = procMatch[1].replace(/\.exe$/i, "");
      return exeName;
    }

    // Try to extract from file patterns in details
    const detailFileMatch = detailsLower.match(
      /([a-z0-9._-]+\.(?:exe|py|ahk|bat|ps1|js|jar))/i
    );
    if (detailFileMatch) {
      return detailFileMatch[1].replace(/\.(exe|py|ahk|bat|ps1|js|jar)$/i, "");
    }

    // Try to extract executable/file reference directly from the signal name
    const nameFileMatch = nameLower.match(
      /([a-z0-9._-]+\.(?:exe|py|ahk|bat|ps1|js|jar))/i
    );
    if (nameFileMatch) {
      return nameFileMatch[1].replace(/\.(exe|py|ahk|bat|ps1|js|jar)$/i, "");
    }

    // Normalize signal name (remove common suffixes, extensions)
    const normalized = nameLower
      .replace(/\.exe$/i, "")
      .replace(
        /\s+(bot|tool|automation|launcher|core|detected|running|script)$/i,
        ""
      )
      .trim();

    // Handle common program names that might have variations
    const programAliases: Record<string, string> = {
      python: "python",
      py: "python",
      "python launcher": "python",
      node: "nodejs",
      "node.js": "nodejs",
      pwsh: "powershell",
      "powershell core": "powershell",
      powershell: "powershell",
      openholdem: "openholdem",
      oh: "openholdem",
      autohotkey: "autohotkey",
      ahk: "autohotkey",
      autoit: "autoit",
    };

    const genericTerms = [
      "script",
      "process",
      "program",
      "application",
      "detected",
      "running",
    ];

    const descriptorTrimmed = normalized
      .replace(
        /^(suspicious|possible|unknown|detected)\s+(code|entropy|process|program|script)\s*/i,
        ""
      )
      .trim();

    const candidates = [
      normalized,
      descriptorTrimmed,
      descriptorTrimmed.includes(":") || descriptorTrimmed.includes("-")
        ? descriptorTrimmed.split(/[:-]/).pop()?.trim()
        : null,
    ];

    const pickCandidate = (candidate: string | null | undefined) => {
      if (!candidate) return null;
      const value = candidate.trim();
      if (!value) return null;
      if (programAliases[value]) {
        return programAliases[value];
      }
      if (
        genericTerms.some(
          (term) => value === term || value.startsWith(term + " ")
        )
      ) {
        return null;
      }
      if (/^[a-z0-9._-]+$/i.test(value)) {
        return value;
      }
      return null;
    };

    for (const candidate of candidates) {
      const selected = pickCandidate(candidate);
      if (selected) {
        return selected;
      }
    }

    return null;
  }

  // Helper to create unique key for a detection
  // For programs/auto categories: consolidate by program name
  // For network: preserve via= information for source tracking
  // For DNS signals: consolidate by pattern name (not domain) for generic patterns
  // For Telegram: consolidate all Telegram-related signals together
  // For others: use category + name + artifact
  private createUniqueKey(sig: Signal): string {
    const device = sig.device_id || "unknown";
    const section = routeToSectionKey(sig);
    const nameBase = (sig.name || "").toLowerCase().trim();
    const artifact = normalizeDetailsForKey(sig.details);
    const detailsLower = (sig.details || "").toLowerCase();

    // SPECIAL: Consolidate all Telegram-related signals together
    // This ensures "Telegram Activity" and "CoinPoker RTA Risk"
    // (when related to Telegram) are grouped as the same threat
    if (
      sig.category === "network" &&
      (nameBase.includes("telegram") || detailsLower.includes("telegram"))
    ) {
      // Extract PID if available for process-specific grouping
      const pidMatch = detailsLower.match(/pid[=:]\s*(\d+)/);
      if (pidMatch) {
        return `${device}:network:telegram:pid:${pidMatch[1]}`;
      }
      // Otherwise group all Telegram detections together (same process)
      return `${device}:network:telegram:consolidated`;
    }

    // For programs and automation categories, consolidate by program name
    // This allows "OpenHoldem" from programs and "OpenHoldem" from auto to share the same key
    if (sig.category === "programs" || sig.category === "auto") {
      const programName = this.extractProgramName(sig);
      if (programName && programName !== nameBase) {
        // Use normalized program name for consolidation
        // Include artifact to distinguish different detection methods (hash vs process)
        return `${device}:program:${programName}:${artifact}`;
      }
    }

    // For DNS signals with generic patterns (Chinese Domain, Telegram), consolidate by name only
    // Don't include domain in artifact to allow multiple domains to consolidate
    if (sig.category === "network" && nameBase.includes("dns:")) {
      const dnsName = nameBase.replace("dns:", "").trim();
      // Generic patterns that should consolidate: "chinese domain", "telegram"
      const genericPatterns = ["chinese domain", "telegram"];
      if (genericPatterns.some((p) => dnsName.includes(p))) {
        // Use just the DNS name without domain-specific details
        return `${device}:network:${section}:${nameBase}`;
      }
    }

    // For network category: preserve via= information in artifact (already handled in extractArtifact)
    // For other categories: use category + name + artifact
    return `${device}:${sig.category}:${section}:${nameBase}:${artifact}`;
  }

  // Helper to check if this is a repeat of the same detection (same source, same details)
  private isRepeatDetection(existing: Stored, sig: Signal): boolean {
    const existingArtifact = normalizeDetailsForKey(existing.details);
    const newArtifact = normalizeDetailsForKey(sig.details);

    // For programs/auto, also check if program name matches
    if (
      (existing.category === "programs" || existing.category === "auto") &&
      (sig.category === "programs" || sig.category === "auto")
    ) {
      const existingProgram = this.extractProgramName(existing);
      const newProgram = this.extractProgramName(sig);
      if (existingProgram && newProgram && existingProgram === newProgram) {
        // Same program - check if same artifact (same detection method)
        return existingArtifact === newArtifact;
      }
    }

    // For other categories: same artifact and category = repeat
    return (
      existingArtifact === newArtifact && existing.category === sig.category
    );
  }

  // Helper to check if this is the same program from different category (should consolidate)
  private isSameProgramDifferentCategory(
    existing: Stored,
    sig: Signal
  ): boolean {
    // Only consolidate between programs and auto categories
    if (
      !(
        (existing.category === "programs" && sig.category === "auto") ||
        (existing.category === "auto" && sig.category === "programs")
      )
    ) {
      return false;
    }

    const existingProgram = this.extractProgramName(existing);
    const newProgram = this.extractProgramName(sig);

    // Must have valid program names and they must match
    return !!(existingProgram && newProgram && existingProgram === newProgram);
  }

  private prune() {
    const now = Date.now();
    for (const [k, arr] of this.store.entries()) {
      const pruned = arr.filter((s) => now - s.timestamp * 1000 < TTL_MS);
      // cap size
      if (pruned.length > MAX_ITEMS_PER_SECTION) {
        pruned.splice(0, pruned.length - MAX_ITEMS_PER_SECTION);
      }
      this.store.set(k, pruned);
    }
    
    // Periodically cleanup old devices to prevent memory bloat
    if (now - this.lastDeviceCleanup > DEVICE_CLEANUP_INTERVAL_MS) {
      this.cleanupDevices(now);
      this.lastDeviceCleanup = now;
    }
  }

  /**
   * Cleanup old/offline devices to prevent memory bloat
   * 
   * STRATEGY:
   * 1. Keep top MAX_DEVICES_IN_MEMORY most active devices (by last_seen)
   * 2. Remove devices that are:
   *    - Not in top N AND
   *    - Either stale (inactive > DEVICE_STALE_THRESHOLD_MS) OR (offline AND logged_out)
   * 
   * IMPORTANT:
   * - This only affects MemoryStore (in-memory cache)
   * - All device data still exists in Redis (if USE_REDIS=true)
   * - Removed devices can be reloaded from Redis when needed
   * - This prevents memory bloat when dealing with thousands of historical devices
   * 
   * @param now - Current timestamp in milliseconds
   */
  private cleanupDevices(now: number): void {
    if (this.devices.size <= MAX_DEVICES_IN_MEMORY) {
      return; // No cleanup needed - we're under the limit
    }

    // Sort devices by last_seen (most recent first)
    // Most recently active devices are kept in memory
    const sortedDevices = Array.from(this.devices.entries())
      .sort((a, b) => b[1].last_seen - a[1].last_seen);

    // Keep top MAX_DEVICES_IN_MEMORY devices (most active)
    const devicesToKeep = new Set(
      sortedDevices
        .slice(0, MAX_DEVICES_IN_MEMORY)
        .map(([deviceId]) => deviceId)
    );

    // Remove stale devices that are not in top N
    // Stale = inactive for DEVICE_STALE_THRESHOLD_MS (default: 30 minutes)
    // Also remove offline+logged_out devices that are not in top N
    let removedCount = 0;
    for (const [deviceId, device] of this.devices.entries()) {
      const isStale = now - device.last_seen > DEVICE_STALE_THRESHOLD_MS;
      const isOffline = now - device.last_seen > DEVICE_TIMEOUT_MS;
      
      // Remove if: not in top N AND (stale OR (offline AND logged out))
      if (!devicesToKeep.has(deviceId) && (isStale || (isOffline && device.logged_out))) {
        this.devices.delete(deviceId);
        removedCount++;
      }
    }

    if (removedCount > 0 && process.env.NODE_ENV === 'development') {
      console.log(`[MemoryStore] Cleaned up ${removedCount} stale devices, keeping ${this.devices.size} active devices`);
    }
  }

  async addSignal(sig: Signal): Promise<void> {
    const section = routeToSectionKey(sig);
    const uniqueKey = this.createUniqueKey(sig);
    const now = Date.now();
    const signalTimestampSec = sig.timestamp ?? Math.floor(now / 1000);
    const eventMs = signalTimestampSec * 1000;

    // Always track device activity
    const device_id = sig.device_id || "unknown";
    const device_name = sig.device_name || `Device ${device_id.slice(0, 8)}`;
    const existing = this.devices.get(device_id);

    // Check for session events (login/logout)
    const isHeartbeat = sig.name.includes("Heartbeat");
    const isBatchReport =
      sig.category === "system" && sig.name.includes("Scan Report");
    const isScannerEvent =
      sig.name.includes("Scanner Started") ||
      sig.name.includes("Scanner Stopping");

    const staleLoggedOut =
      existing &&
      existing.logged_out &&
      existing.session_end > 0 &&
      eventMs <= existing.session_end;

    const isOlderThanLastSeen = existing && eventMs < (existing.last_seen || 0);

    if (staleLoggedOut || isOlderThanLastSeen) {
      return;
    }

    // Check session events on heartbeats, batch reports, scanner events, or new devices
    // Scanner events are critical for accurate online/offline tracking
    if (isHeartbeat || isBatchReport || isScannerEvent || !existing) {
      this._checkSessionEvents(device_id, device_name, eventMs, existing);
    }

    const latestRecord = this.devices.get(device_id) || existing;
    const baseData = latestRecord || {
      device_id,
      device_name,
      last_seen: eventMs,
      signal_count: 0,
      unique_detection_count: 0,
      historical_threat_levels: [],
      session_start: eventMs,
      threat_score: 0,
      logged_out: false,
      session_end: 0,
      ip_address: undefined,
    };

    const shouldSkipLoggedOut =
      baseData.logged_out &&
      !isHeartbeat &&
      !isBatchReport &&
      eventMs <= (baseData.session_end || baseData.last_seen);

    if (shouldSkipLoggedOut) {
      return;
    }

    const updatedData = {
      ...baseData,
      device_id,
      device_name,
      last_seen: Math.max(baseData.last_seen || 0, eventMs),
      signal_count: (baseData.signal_count || 0) + 1,
      unique_detection_count: baseData.unique_detection_count,
      historical_threat_levels: baseData.historical_threat_levels,
      session_start: baseData.session_start || eventMs,
      threat_score: baseData.threat_score,
      logged_out: baseData.logged_out,
      session_end: baseData.session_end,
      ip_address: sig.device_ip || baseData.ip_address || undefined,
    };

    this.devices.set(device_id, updatedData);

    // If player is logged out, don't count new detections for scoring
    if (updatedData.logged_out && !isHeartbeat && !isBatchReport) {
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[Store] Device ${device_id} is logged out - skipping detection scoring`
        );
      }
      return; // Don't store detections when logged out
    }

    // PERFORMANCE: Signal logging removed - too verbose for production
    // Individual signal details can be viewed in dashboard UI

    // Special handling for batch reports - always store them without deduplication
    if (sig.category === "system" && sig.name.includes("Scan Report")) {
      const systemSection = "system_reports" as SectionKey;
      const id = `${++this.lastSeq}-${Math.random().toString(36).slice(2, 7)}`;
      const s: Stored = {
        ...sig,
        id,
        section: systemSection,
        uniqueKey: id, // Always unique for batch reports
        firstSeen: sig.timestamp,
      };

      const arr = this.store.get(systemSection) || [];
      arr.push(s);
      this.store.set(systemSection, arr);

      // Update device signal count for batch reports
      const batchDeviceData = this.devices.get(device_id);
      if (batchDeviceData) {
        batchDeviceData.signal_count++;
        batchDeviceData.last_seen = Math.max(
          batchDeviceData.last_seen || 0,
          eventMs
        );
        this.devices.set(device_id, batchDeviceData);
      }

      // Update device snapshot cache (for instant loading)
      await this.updateDeviceSnapshotCache(device_id);

      // Update devices list cache (for instant homepage loading)
      await this.updateDevicesListCache();

      this.prune();
      return;
    }

    // Smart filtering - store everything but filter display
    // Skip only truly irrelevant signals
    if (sig.status === "OK") {
      return; // Skip OK signals completely
    }

    // Filter out unwanted INFO signals (except Threat Summary, Heartbeat, Batch Reports, and Player Name Detected)
    if (
      sig.status === "INFO" &&
      sig.name !== "Threat Summary" &&
      sig.name !== "Player Name Detected" &&
      !sig.name.includes("Heartbeat") &&
      !sig.name.includes("Scan Report")
    ) {
      if (
        !sig.details?.includes("Bot probability") &&
        !sig.details?.includes("Active threats")
      ) {
        return; // Skip irrelevant INFO signals
      }
    }

    // Store system signals but mark them (for filtering in UI later)
    // Don't return here - let them through to store

    // Prepare current section items
    const arr = this.store.get(section) || [];
    const existingIndex = arr.findIndex(
      (existing) => existing.uniqueKey === uniqueKey
    );

    // Player Name Detected signals are now properly handled

    // Check for consolidation: same program from different category (programs vs auto)
    // This must be checked BEFORE uniqueKey lookup because the keys might be different
    // Also check for same program from same category with different detection methods
    let consolidationMatch: Stored | null = null;
    const consolidationMatches: Array<{
      item: Stored;
      section: SectionKey;
      index: number;
    }> = [];
    if (sig.category === "programs" || sig.category === "auto") {
      const programName = this.extractProgramName(sig);
      if (programName) {
        // Search all sections for same program (from any category or same category with different detection method)
        for (const [sectionKey, sectionItems] of this.store.entries()) {
          for (let i = 0; i < sectionItems.length; i++) {
            const item = sectionItems[i];
            const itemProgramName = this.extractProgramName(item);

            // Same program from different category (programs vs auto)
            if (this.isSameProgramDifferentCategory(item, sig)) {
              consolidationMatches.push({
                item,
                section: sectionKey,
                index: i,
              });
              this.consolidationMeta.set(item, {
                section: sectionKey,
                index: i,
              });
              if (!consolidationMatch) {
                consolidationMatch = item;
              }
            }
            // Same program from same category but different detection method (hash vs process)
            else if (
              itemProgramName === programName &&
              (item.category === sig.category ||
                (item.category === "programs" && sig.category === "auto") ||
                (item.category === "auto" && sig.category === "programs"))
            ) {
              // Only consolidate if not already in matches list
              const alreadyMatched = consolidationMatches.some(
                (m) => m.item.uniqueKey === item.uniqueKey
              );
              if (!alreadyMatched) {
                consolidationMatches.push({
                  item,
                  section: sectionKey,
                  index: i,
                });
                this.consolidationMeta.set(item, {
                  section: sectionKey,
                  index: i,
                });
                if (!consolidationMatch) {
                  consolidationMatch = item;
                }
              }
            }
          }
        }
      }
    }

    // Cooldown handling: if duplicate within cooldown, update existing item instead of skipping
    const lastSent = this.recentSignals.get(uniqueKey);
    if (lastSent && now - lastSent < SIGNAL_COOLDOWN_MS) {
      if (existingIndex !== -1) {
        const item = arr[existingIndex];

        // Check if this is a repeat of the same detection (same source, same details)
        if (this.isRepeatDetection(item, sig)) {
          // Same detection from same source - just keep it alive, don't increment
          item.timestamp = sig.timestamp;
          item.status = sig.status; // Update status if it changed
          // Keep existing details (preserve multiplier from Python if present)
          arr[existingIndex] = item;
          this.store.set(section, arr);

          const deviceData2 = this.devices.get(device_id);
          if (deviceData2) {
            deviceData2.last_seen = Math.max(
              deviceData2.last_seen || 0,
              eventMs
            );
            this.devices.set(device_id, deviceData2);
          }
          this.recentSignals.set(uniqueKey, eventMs);
          this.prune();
          return;
        }

        // Different detection (different source or details) - increment counter
        const newCount = (item.detections || 1) + 1;
        item.detections = newCount;
        item.timestamp = sig.timestamp;
        item.status = sig.status;
        // Only add multiplier if not already present from Python code
        const existingDetails = item.details || "";
        if (!/(\(x\d+\)|\[x\d+\])/i.test(existingDetails)) {
          item.details = formatDetailsWithCount(
            sig.details ?? item.details,
            newCount
          );
        } else {
          // Keep existing multiplier from Python code, just update other fields
          item.details = sig.details ?? item.details;
        }
        arr[existingIndex] = item;
        this.store.set(section, arr);

        const deviceData2 = this.devices.get(device_id);
        if (deviceData2) {
          deviceData2.last_seen = Math.max(deviceData2.last_seen || 0, eventMs);
          this.devices.set(device_id, deviceData2);
        }
        this.recentSignals.set(uniqueKey, eventMs);
        this.prune();
        return;
      }
      // fall through if no existing item (rare)
    }

    // If already exists: update and increment detections ONLY if different source/details
    if (existingIndex !== -1) {
      const item = arr[existingIndex];

      // Check if this is a repeat of the same detection
      if (this.isRepeatDetection(item, sig)) {
        // Same detection from same source - just keep it alive, don't increment
        item.timestamp = sig.timestamp;
        item.status = sig.status;
        // Keep existing details (preserve multiplier from Python if present)
        arr[existingIndex] = item;
        this.store.set(section, arr);

        const existingDev = this.devices.get(device_id);
        if (existingDev) {
          existingDev.last_seen = Math.max(existingDev.last_seen || 0, eventMs);
          this.devices.set(device_id, existingDev);
        }

        this.recentSignals.set(uniqueKey, eventMs);
        this.prune();
        return;
      }

      // Different detection (different source or details) - increment counter
      const newCount = (item.detections || 1) + 1;
      item.detections = newCount;
      item.timestamp = sig.timestamp;
      item.status = sig.status;
      // Only add multiplier if not already present from Python code
      const existingDetails = item.details || "";
      if (!/(\(x\d+\)|\[x\d+\])/i.test(existingDetails)) {
        item.details = formatDetailsWithCount(
          sig.details ?? item.details,
          newCount
        );
      } else {
        // Keep existing multiplier from Python code, just update other fields
        item.details = sig.details ?? item.details;
      }
      arr[existingIndex] = item;
      this.store.set(section, arr);

      const existingDev = this.devices.get(device_id);
      if (existingDev) {
        existingDev.last_seen = Math.max(existingDev.last_seen || 0, eventMs);
        this.devices.set(device_id, existingDev);
      }

      this.recentSignals.set(uniqueKey, eventMs);
      this.prune();
      return;
    }

    // Check for consolidation with existing items from same/different category
    if (consolidationMatch && consolidationMatches.length > 0) {
      const meta = this.consolidationMeta.get(consolidationMatch);
      const consolidationSection = meta?.section;
      const consolidationItemIndex = meta?.index;

      if (
        consolidationSection !== undefined &&
        consolidationItemIndex !== undefined
      ) {
        const consolidationArr = this.store.get(consolidationSection) || [];
        const consolidationItem = consolidationArr[consolidationItemIndex];

        if (consolidationItem) {
        // Start with the existing item as base
        const consolidatedItem = { ...consolidationItem };

        // Count total detections from all matches + new signal
        let totalCount = consolidationItem.detections || 1;
        let highestStatus = consolidationItem.status;
        let highestStatusWeight = getThreatWeight(consolidationItem.status);
        const allDetails: string[] = [];

        // Collect details from all matches
        if (consolidationItem.details) {
          allDetails.push(consolidationItem.details);
        }

        // Process all consolidation matches
        for (const match of consolidationMatches) {
          const matchItem = match.item;
          if (matchItem.uniqueKey !== consolidationItem.uniqueKey) {
            totalCount += matchItem.detections || 1;

            // Track highest status
            const matchStatusWeight = getThreatWeight(matchItem.status);
            if (matchStatusWeight > highestStatusWeight) {
              highestStatus = matchItem.status;
              highestStatusWeight = matchStatusWeight;
            }

            // Collect details
            if (matchItem.details) {
              allDetails.push(matchItem.details);
            }
          }
        }

        // Add new signal details
        totalCount += 1;
        const newStatusWeight = getThreatWeight(sig.status);
        if (newStatusWeight > highestStatusWeight) {
          highestStatus = sig.status;
        }
        if (sig.details) {
          allDetails.push(sig.details);
        }

        // Update consolidated item
        consolidatedItem.detections = totalCount;
        consolidatedItem.timestamp = sig.timestamp;
        consolidatedItem.status = highestStatus; // Always use highest status

        // Merge details - combine unique information from all sources
        const uniqueDetails = Array.from(
          new Set(allDetails.map((d) => d.trim()).filter((d) => d))
        );
        const combinedDetails = uniqueDetails.join(" | ");

        // Format with multiplier if count > 1
        if (totalCount > 1) {
          consolidatedItem.details = formatDetailsWithCount(
            combinedDetails,
            totalCount
          );
        } else {
          consolidatedItem.details = combinedDetails;
        }

        // Use programs as primary category if consolidating from programs/auto
        consolidatedItem.category = "programs";
        consolidatedItem.name = sig.name; // Use the most descriptive name

        // Update uniqueKey to match the consolidated key format
        consolidatedItem.uniqueKey = uniqueKey;

        // Remove all old items that were consolidated
        // Sort by section and index (descending) to avoid index shifting issues
        const itemsBySection = new Map<SectionKey, number[]>();
        for (const match of consolidationMatches) {
          if (!itemsBySection.has(match.section)) {
            itemsBySection.set(match.section, []);
          }
          itemsBySection.get(match.section)!.push(match.index);
        }

        // Remove items from each section (sort indices descending to avoid shifting)
        for (const [matchSection, indices] of itemsBySection.entries()) {
          const matchArr = this.store.get(matchSection) || [];
          // Sort indices descending so we remove from end first
          const sortedIndices = [...indices].sort((a, b) => b - a);
          for (const index of sortedIndices) {
            matchArr.splice(index, 1);
          }
          this.store.set(matchSection, matchArr);
        }

        // Add consolidated item to current section
        arr.push(consolidatedItem);
        this.store.set(section, arr);

        const existingDev = this.devices.get(device_id);
        if (existingDev) {
          existingDev.last_seen = Math.max(existingDev.last_seen || 0, eventMs);
          this.devices.set(device_id, existingDev);
        }

        this.recentSignals.set(uniqueKey, eventMs);
        this.prune();
        return;
      }
    }
  }

    // New unique detection
    const id = `${++this.lastSeq}-${Math.random().toString(36).slice(2, 7)}`;
    const s: Stored = {
      ...sig,
      id,
      section,
      uniqueKey,
      firstSeen: sig.timestamp,
      detections: 1,
    };
    arr.push(s);
    this.store.set(section, arr);

    // Increment unique detection count and update historical data (only for first insert)
    const currentDeviceData = this.devices.get(device_id);
    if (currentDeviceData) {
      currentDeviceData.unique_detection_count++;
      const signalThreatWeight = getThreatWeight(sig.status);
      currentDeviceData.threat_score += signalThreatWeight;
      const currentThreatLevel = Math.min(100, currentDeviceData.threat_score);
      currentDeviceData.historical_threat_levels.push(currentThreatLevel);
      if (currentDeviceData.historical_threat_levels.length > 100) {
        currentDeviceData.historical_threat_levels =
          currentDeviceData.historical_threat_levels.slice(-100);
      }
      this.devices.set(device_id, currentDeviceData);
    }

    // Update hourly aggregation for non-system signals
    if (sig.category !== "system") {
      await this.updateHourlyAggregation(device_id, sig);
    }

    this.recentSignals.set(uniqueKey, eventMs);
    for (const [key, timestamp] of this.recentSignals.entries()) {
      if (now - timestamp > SIGNAL_COOLDOWN_MS) {
        this.recentSignals.delete(key);
      }
    }

    this.prune();
  }

  async addSignals(sigs: Signal[]): Promise<void> {
    for (const s of sigs) {
      await this.addSignal(s);
    }
  }

  async getSnapshot(device_id?: string): Promise<{
    serverTime: number;
    sections: Record<string, { items: Stored[] }>;
  }> {
    this.prune();
    const now = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();
    const sections: Record<string, { items: Stored[] }> = {};

    // Check if device is online (if device_id is specified)
    let isDeviceOnline = true;
    if (device_id) {
      const device = this.devices.get(device_id);
      if (device) {
        // Device is offline if last_seen is older than DEVICE_TIMEOUT_MS or logged out
        isDeviceOnline =
          nowMs - device.last_seen < DEVICE_TIMEOUT_MS && !device.logged_out;
      } else {
        // Device not found in store - treat as offline
        isDeviceOnline = false;
      }
    }

    for (const [k, arr] of this.store.entries()) {
      // Filter by device if specified
      let filtered = arr;
      if (device_id) {
        // If device is offline, return empty sections (no detections visible)
        if (!isDeviceOnline) {
          sections[k] = { items: [] };
          continue;
        }

        filtered = arr.filter((s) => {
          const sDeviceId = s.device_id || "unknown";
          // Exact match
          if (sDeviceId === device_id) return true;
          // Prefix match (device_id might be truncated in URL)
          if (sDeviceId.startsWith(device_id)) return true;
          // Reverse prefix match (device_id is full but URL shows truncated)
          if (
            device_id.length >= 8 &&
            sDeviceId.startsWith(device_id.substring(0, 8))
          )
            return true;
          // For "Player Name Detected" signals, include them even if device_id doesn't match exactly
          // Dashboard will handle matching via device_ip/device_name fallbacks
          if (k === "system_reports" && s.name === "Player Name Detected") {
            return true; // Include all Player Name Detected signals for matching in dashboard
          }
          return false;
        });
      }
      sections[k] = { items: filtered.slice(-50) }; // last 50 per section to keep payload small
    }

    return {
      serverTime: now,
      sections,
    };
  }

  // Update device snapshot cache (called when batch reports arrive)
  private async updateDeviceSnapshotCache(device_id: string): Promise<void> {
    const snapshot = await this.getSnapshot(device_id);
    this.deviceSnapshotCache.set(device_id, {
      snapshot,
      cachedAt: Date.now(),
    });

    // Keep only top 20 devices in cache to save memory
    if (this.deviceSnapshotCache.size > 20) {
      const devices = await this.getDevices();
      const top20 = devices.devices.slice(0, 20).map((d) => d.device_id);

      // Remove devices not in top 20
      for (const [cachedDeviceId] of this.deviceSnapshotCache) {
        if (!top20.includes(cachedDeviceId)) {
          this.deviceSnapshotCache.delete(cachedDeviceId);
        }
      }
    }
  }

  // Get cached snapshot (instant if available)
  // Note: Even if cached, we check online status to ensure offline devices show no detections
  async getCachedSnapshot(device_id: string): Promise<{
    serverTime: number;
    sections: Record<string, { items: Stored[] }>;
    cached?: boolean;
  } | null> {
    const cached = this.deviceSnapshotCache.get(device_id);
    if (!cached) return null;

    // Check if device is still online - if offline, return empty snapshot even if cached
    const nowMs = Date.now();
    const device = this.devices.get(device_id);
    if (device) {
      const isDeviceOnline =
        nowMs - device.last_seen < DEVICE_TIMEOUT_MS && !device.logged_out;
      if (!isDeviceOnline) {
        // Device went offline - return empty snapshot regardless of cache
        const now = Math.floor(Date.now() / 1000);
        const emptySections: Record<string, { items: Stored[] }> = {};
        for (const [k] of this.store.entries()) {
          emptySections[k] = { items: [] };
        }
        return {
          serverTime: now,
          sections: emptySections,
          cached: false, // Mark as not cached since we're returning empty
        };
      }
    }

    // Cache valid for 5 minutes
    const cacheAge = Date.now() - cached.cachedAt;
    if (cacheAge > 5 * 60 * 1000) {
      this.deviceSnapshotCache.delete(device_id);
      return null;
    }

    return { ...cached.snapshot, cached: true };
  }

  // Update hourly aggregation
  private async updateHourlyAggregation(
    device_id: string,
    sig: Signal
  ): Promise<void> {
    const now = new Date(sig.timestamp * 1000);
    const hour = `${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(
      now.getUTCHours()
    ).padStart(2, "0")}`;

    const aggregates = this.hourlyAggregates.get(device_id) || [];
    let hourData = aggregates.find((h) => h.hour === hour);

    if (!hourData) {
      const hourTimestamp = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        0,
        0
      );
      hourData = {
        hour,
        timestamp: Math.floor(hourTimestamp / 1000),
        segments: this.segmentsTemplate(),
        total_points: 0,
        avg_score: 0,
        avg_bot_probability: 0,
        sample_count: 0,
        active_minutes: 60,
      };
      aggregates.push(hourData);
    }

    // Update segment counts
    const segment =
      hourData.segments[sig.category as keyof typeof hourData.segments];
    if (segment) {
      if (sig.status === "CRITICAL") segment.critical++;
      else if (sig.status === "ALERT") segment.alert++;
      else if (sig.status === "WARN") segment.warn++;

      const points = getThreatWeight(sig.status);
      segment.total_points += points;
      hourData.total_points += points;
      hourData.sample_count++;

      if (hourData.sample_count > 0) {
        hourData.avg_score = hourData.total_points / hourData.sample_count;
        hourData.avg_bot_probability = hourData.avg_score;
      }
    }

    // Keep only last 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const filtered = aggregates.filter((h) => {
      const hourTime = (h.timestamp ?? new Date(h.hour).getTime() / 1000) * 1000;
      return hourTime > cutoff;
    });

    this.hourlyAggregates.set(device_id, filtered);
  }

  // Get hourly aggregation data
  async getHourlyAggregates(
    device_id: string,
    hours: number = 24,
    minutesOverride?: number
  ): Promise<AggregatePoint[]> {
    const aggregates = this.hourlyAggregates.get(device_id) || [];
    // If minutesOverride is provided, use it to calculate how many hourly aggregates to return
    // (MemoryStore doesn't have minute-level data, so we approximate)
    if (minutesOverride !== undefined && hours <= 2) {
      // For short periods, return fewer aggregates based on minutes
      const hoursToReturn = Math.max(1, Math.ceil(minutesOverride / 60));
      return aggregates.slice(-hoursToReturn);
    }
    return aggregates.slice(-hours);
  }

  // Update devices list cache
  private async updateDevicesListCache(): Promise<void> {
    const devices = await this.getDevices();
    this.devicesListCache = {
      devices: devices.devices,
      total: devices.total,
      cachedAt: Date.now(),
    };
  }

  // Get cached devices list (instant if available)
  async getCachedDevicesList(): Promise<{
    devices: DeviceListEntry[];
    total: number;
    cached?: boolean;
  } | null> {
    if (!this.devicesListCache) return null;

    // Cache valid for 30 seconds (refreshes frequently from batch reports)
    const cacheAge = Date.now() - this.devicesListCache.cachedAt;
    if (cacheAge > 30 * 1000) {
      this.devicesListCache = null;
      return null;
    }

    return { ...this.devicesListCache, cached: true };
  }

  async getDevices(): Promise<{
    devices: Array<{
      device_id: string;
      device_name: string;
      device_hostname?: string;
      last_seen: number;
      signal_count: number;
      unique_detection_count: number;
      threat_level: number;
      historical_threat_levels: number[];
      session_start: number;
      session_duration: number;
      player_nickname?: string;
      player_nickname_confidence?: number;
      score_per_hour?: number;
      threat_trend: "up" | "down" | "stable";
      is_online: boolean;
      status_message?: string; // Detailed status message for UI
      status_color?: string; // Color class for status display
      ip_address?: string;
    }>;
    total: number;
  }> {
    const now = Date.now();
    
    // Periodically cleanup old devices
    if (now - this.lastDeviceCleanup > DEVICE_CLEANUP_INTERVAL_MS) {
      this.cleanupDevices(now);
      this.lastDeviceCleanup = now;
    }
    
    // Check for timeout and mark devices as logged out
    for (const [device_id, device] of this.devices.entries()) {
      if (
        !device.logged_out &&
        device.last_seen > 0 &&
        now - device.last_seen > DEVICE_TIMEOUT_MS
      ) {
        device.logged_out = true;
        device.session_end = now;
        this.devices.set(device_id, device);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Store] Session timeout for device ${device_id}`);
        }
      }
    }

    // Return ALL devices (both online and offline), sorted by last_seen
    const allDevices = Array.from(this.devices.values())
      .sort((a, b) => b.last_seen - a.last_seen)
      .map((device) => {
        // Determine if device is online
        const is_online =
          now - device.last_seen < DEVICE_TIMEOUT_MS && !device.logged_out;

        // Calculate threat trend
        const levels = device.historical_threat_levels;
        let threat_trend: "up" | "down" | "stable" = "stable";

        if (levels.length >= 3) {
          const recent = levels.slice(-3);
          const avgRecent =
            recent.reduce((sum, level) => sum + level, 0) / recent.length;
          const avgOlder =
            levels.slice(-6, -3).reduce((sum, level) => sum + level, 0) / 3;

          if (avgRecent > avgOlder + 5) threat_trend = "up";
          else if (avgRecent < avgOlder - 5) threat_trend = "down";
        }

        // Calculate threat_level from CURRENT active signals (not cumulative)
        // Get all items in store for this device
        const deviceItems: Stored[] = [];
        for (const [, items] of this.store.entries()) {
          for (const item of items) {
            if ((item.device_id || "unknown") === device.device_id) {
              // Only include items that are recent (not expired by TTL)
              const age = now - item.timestamp * 1000;
              if (age < TTL_MS) {
                deviceItems.push(item);
              }
            }
          }
        }

        // Count by status (exclude system_reports) - 4-level system
        const criticalCount = deviceItems.filter(
          (i) => i.status === "CRITICAL" && i.section !== "system_reports"
        ).length;
        const alertCount = deviceItems.filter(
          (i) => i.status === "ALERT" && i.section !== "system_reports"
        ).length;
        const warnCount = deviceItems.filter(
          (i) => i.status === "WARN" && i.section !== "system_reports"
        ).length;
        const infoCount = deviceItems.filter(
          (i) => i.status === "INFO" && i.section !== "system_reports"
        ).length;

        /**
         * FALLBACK THREAT SCORING
         * =======================
         * This calculation is ONLY used when Redis is unavailable or batch reports haven't arrived.
         * 
         * PRIMARY SOURCE: bot_probability from batch reports (every 92s)
         * - Backend performs intelligent deduplication (e.g., OpenHoldem from 3 sources = 1 threat)
         * - Frontend MUST NOT override bot_probability with count-based calculations
         * 
         * This fallback uses simple multiplication which can lead to:
         * - Double-counting of same process detected multiple ways
         * - Incorrect scores compared to backend's deduplicated calculation
         */
        const threat_level = Math.min(
          100,
          criticalCount * 15 + alertCount * 10 + warnCount * 5 + infoCount * 0
        );

        // Calculate normalized score (score per hour active)
        const sessionDurationMs = now - device.session_start;
        const sessionHours = Math.max(
          0.1,
          sessionDurationMs / (1000 * 60 * 60)
        ); // Min 0.1h to avoid division by zero
        const score_per_hour = threat_level / sessionHours;

        // Calculate detailed status for better user feedback
        // Heartbeats are sent every 30s, but Redis writes are throttled to every 90s (3 heartbeats)
        // Unified batch reports are sent every 92s
        const timeSinceLastSeen = now - device.last_seen;
        const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
        const MISSING_HEARTBEATS = Math.floor(
          timeSinceLastSeen / HEARTBEAT_INTERVAL_MS
        );
        const BATCH_REPORT_INTERVAL_MS = 92 * 1000; // Unified batch reports every 92s

        // PROACTIVE: Show offline status earlier (when approaching threshold)
        // This makes the transition more visible (shows offline at 3.5 min instead of 4 min)
        const OFFLINE_THRESHOLD_MS = DEVICE_TIMEOUT_MS * 0.875; // 3.5 minutes (87.5% of 4 min)
        const isApproachingOffline =
          !is_online || timeSinceLastSeen >= OFFLINE_THRESHOLD_MS;

        let statusMessage = "";
        let statusColor = "text-green-400";

        if (isApproachingOffline || !is_online) {
          // Offline status (or approaching offline - show early warning)
          const minutesOffline = Math.floor(timeSinceLastSeen / (60 * 1000));
          if (!is_online) {
            // Fully offline
            statusMessage = `Offline ${
              minutesOffline > 0 ? `${minutesOffline}m` : "<1m"
            } ago`;
            statusColor = "text-slate-400";
          } else {
            // Approaching offline (3.5-4 min) - show warning
            statusMessage = `Going offline (${MISSING_HEARTBEATS} heartbeats)`;
            statusColor = "text-orange-400";
          }
        } else if (device.logged_out) {
          // Logged out but recently active
          statusMessage = "Logged out";
          statusColor = "text-yellow-400";
        } else if (timeSinceLastSeen > BATCH_REPORT_INTERVAL_MS * 1.5) {
          // Missing multiple batch reports (likely not playing)
          statusMessage = `No activity (${MISSING_HEARTBEATS} heartbeats missed)`;
          statusColor = "text-yellow-400";
        } else if (timeSinceLastSeen > HEARTBEAT_INTERVAL_MS * 3) {
          // Missing some heartbeats (possible network delay or slow batch reports)
          statusMessage = `${MISSING_HEARTBEATS} heartbeats missed`;
          statusColor = "text-yellow-400";
        } else if (timeSinceLastSeen < HEARTBEAT_INTERVAL_MS * 2) {
          // Recent activity - fully active
          statusMessage = "Active";
          statusColor = "text-green-400";
        } else {
          // Normal activity
          statusMessage = "Connected";
          statusColor = "text-green-400";
        }

        return {
          device_id: device.device_id,
          device_name: device.device_name,
          device_hostname: device.device_name,
          player_nickname: device.player_nickname ?? device.device_name,
          player_nickname_confidence: device.player_nickname_confidence,
          last_seen: device.last_seen,
          signal_count: device.signal_count,
          unique_detection_count: device.unique_detection_count,
          threat_level,
          score_per_hour: Math.round(score_per_hour * 10) / 10, // Round to 1 decimal
          historical_threat_levels: device.historical_threat_levels,
          session_start: device.session_start,
          session_duration: now - device.session_start,
          threat_trend,
          is_online,
          status_message: statusMessage,
          status_color: statusColor,
          ip_address: device.ip_address,
        };
      });

    return {
      devices: allDevices,
      total: allDevices.length,
    };
  }
}
