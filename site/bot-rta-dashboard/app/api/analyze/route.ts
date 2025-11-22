import { NextRequest } from "next/server";
import OpenAI from "openai";
import { createClient } from "redis";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildDetectionContext,
  categorizeSignals,
} from "@/lib/detections/detection-context";
import { getProgramExplanation } from "@/lib/detections/detection-info";
import { successResponse, errorResponse, parseJsonBody } from "@/lib/utils/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazy initialization to avoid build-time errors
let openaiInstance: OpenAI | null = null;
 
const configCache: Map<string, { data: any; timestamp: number }> = new Map();
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

function getOpenAI(): OpenAI {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    openaiInstance = new OpenAI({ apiKey });
  }
  return openaiInstance;
}

// Load configuration files with caching
 
function loadConfigFile(filename: string): any {
  try {
    // Check cache first
    const cached = configCache.get(filename);
    if (cached && Date.now() - cached.timestamp < CONFIG_CACHE_TTL) {
      return cached.data;
    }

    // Try multiple possible paths for Next.js compatibility
    const possiblePaths = [
      join(process.cwd(), "configs", filename),
      join(process.cwd(), "site", "bot-rta-dashboard", "configs", filename),
    ];

    for (const configPath of possiblePaths) {
      try {
        const content = readFileSync(configPath, "utf-8");
        const data = JSON.parse(content);
        // Cache the result
        configCache.set(filename, { data, timestamp: Date.now() });
        return data;
      } catch (e) {
        // Try next path
        continue;
      }
    }

    console.warn(`[Analyze] Config file ${filename} not found in any expected location`);
    return null;
  } catch (error) {
    console.error(`[Analyze] Failed to load config ${filename}:`, error);
    return null;
  }
}

// Load all configuration files into a single object
 
function loadAllConfigs(): any {
   
  const allConfigs: any = {};
  const configFiles = ["programs_registry.json", "behaviour_config.json", "network_config.json", "screen_config.json", "vm_config.json"];
  for (const filename of configFiles) {
    const data = loadConfigFile(filename);
    if (data) {
      allConfigs[filename] = data;
    }
  }
  return allConfigs;
}

// Time presets for historical data queries (shared constant)
const TIME_PRESETS: Record<string, number> = {
  "1h": 3600,
  "3h": 3 * 3600,
  "6h": 6 * 3600,
  "12h": 12 * 3600,
  "24h": 24 * 3600,
  "3d": 3 * 24 * 3600,
  "7d": 7 * 24 * 3600,
  "30d": 30 * 24 * 3600,
};

const severityWeights: Record<string, number> = {
  CRITICAL: 4,
  ALERT: 3,
  WARN: 2,
  INFO: 1,
};

const MODEL_PREFERENCE: Array<{ name: string; maxTokens: number }> = [
  { name: "gpt-5.1", maxTokens: 4000 },
  { name: "gpt-5.1-mini", maxTokens: 3800 },
  { name: "gpt-4.1", maxTokens: 3500 },
  { name: "gpt-4.1-mini", maxTokens: 3200 },
  { name: "gpt-4o", maxTokens: 3000 },
];

const SYSTEM_PROMPT = `Du är en erfaren poker-säkerhetsanalytiker.
Du får sammanfattade detektioner och ska avgöra om spelaren kör bot/RTA/makro/overlay eller verkar ren.
Besvara alltid på svenska, strukturerat och kortfattat.`;

function summarizeTopSignals(
  signals: any[],
  limit = 8,
): Array<{
  category: string;
  name: string;
  status: string;
  timestamp?: number;
  details?: string;
}> {
  return signals
    .filter((s) => s?.category && s?.name)
    .map((s) => ({
      ...s,
      _score:
        (severityWeights[String(s.status).toUpperCase()] || 0) * 1_000_000 +
        (s.timestamp || 0),
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map((s) => ({
      category: s.category,
      name: s.name,
      status: s.status,
      timestamp: s.timestamp,
      details: s.details,
    }));
}

function buildCategorySentence(categoryThreats?: Record<string, number>) {
  if (!categoryThreats) return "Inga kategoripoäng rapporterade.";
  const entries = Object.entries(categoryThreats)
    .filter(([, value]) => value && value > 0)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .map(([key, value]) => `${key}: ${Math.round(value)}%`);
  return entries.length
    ? `Kategori-tryck → ${entries.join(", ")}.`
    : "Kategori-tryck är lågt i samtliga segment.";
}

function buildAnalysisSummary(options: {
  deviceId?: string;
  timePreset: string;
  threatLevel?: number;
  categoryThreats?: Record<string, number>;
  stats?: Record<string, any>;
  timeRanges: Record<string, number>;
  topSignals: Array<{
    category: string;
    name: string;
    status: string;
    timestamp?: number;
    details?: string;
  }>;
  programDetails: string[];
  totalSignals: number;
  currentSignalsCount: number;
  historicalSignalsCount: number;
  categorizedSnapshot: Record<string, any>;
}) {
  const lines: string[] = [];
  lines.push(
    `Device: ${options.deviceId || "okänd"} | Fönster: ${options.timePreset}`,
  );
  lines.push(
    `Analyserade signaler: ${options.totalSignals} (live ${options.currentSignalsCount}, historiska ${options.historicalSignalsCount})`,
  );
  lines.push(`Total hotnivå: ${options.threatLevel ?? 0}%`);
  lines.push(buildCategorySentence(options.categoryThreats));
  if (options.stats) {
    lines.push(
      `Status-counts – Critical ${options.stats.critical ?? 0}, Alert ${
        options.stats.alerts ?? 0
      }, Warn ${options.stats.warnings ?? 0}, Info ${
        options.stats.info ?? 0
      }`,
    );
  }
  lines.push(
    `Aktivitet – 1h:${options.timeRanges.lastHour}, 24h:${options.timeRanges.last24Hours}, 7d:${options.timeRanges.last7Days}`,
  );
  const categoriesListed = Object.entries(options.categorizedSnapshot)
    .map(([key, list]) => `${key}:${list.length}`)
    .join(", ");
  lines.push(
    `Segment-sammanfattning: ${categoriesListed || "Inga kategorier funna"}.`,
  );
  if (options.programDetails.length) {
    lines.push(
      `Program-registerträffar:\n${options.programDetails
        .slice(0, 6)
        .join("\n")}`,
    );
  }
  if (options.topSignals.length) {
    lines.push(
      "Tyngsta detektioner:",
      ...options.topSignals.map((sig) => {
        const ts = sig.timestamp
          ? new Date(
              sig.timestamp < 10_000_000_000
                ? sig.timestamp * 1000
                : sig.timestamp,
            ).toLocaleString()
          : "okänd tid";
        return `  • [${sig.status}] ${sig.category} – ${sig.name} (${ts}) ${
          sig.details ? "- " + sig.details : ""
        }`;
      }),
    );
  }
  return lines.join("\n");
}

function buildSyntheticSignalsFromCategories(
  categoryThreats?: Record<string, number>,
) {
  if (!categoryThreats) return [];
  const now = Date.now();
  return Object.entries(categoryThreats)
    .filter(([, value]) => value && value > 0)
    .map(([category, value]) => {
      const pct = Math.round(value);
      const status =
        pct >= 70 ? "ALERT" : pct >= 40 ? "WARN" : pct >= 20 ? "INFO" : "INFO";
      return {
        category,
        name: `${category}-aggregate`,
        status,
        details: `Syntetisk kategori-signal ~${pct}% risk baserat på segmentdata`,
        timestamp: now,
        synthetic: true,
      };
    });
}

// Get historical signals from Redis - optimized version
async function getHistoricalSignals(
  deviceId: string,
  timePreset: string
   
): Promise<any[]> {
  // Validate inputs
  if (!deviceId || typeof deviceId !== "string" || deviceId.trim().length === 0) {
    console.warn("[Analyze] Invalid deviceId provided to getHistoricalSignals");
    return [];
  }

  if (!TIME_PRESETS[timePreset]) {
    console.warn(`[Analyze] Invalid timePreset: ${timePreset}`);
    return [];
  }

  const redis = createClient({ 
    url: process.env.REDIS_URL || "redis://localhost:6379",
    socket: {
      connectTimeout: 5000, // 5 second timeout
      reconnectStrategy: false, // Don't auto-reconnect for one-off queries
    }
  });
  try {
    await redis.connect();

    const seconds = TIME_PRESETS[timePreset] || 86400;
    const now = Math.floor(Date.now() / 1000);
    const minTimestamp = now - seconds;

     
    const signals: any[] = [];

    // Get segment combinations for the device
    const segmentIndexKey = `segment_index:${deviceId}`;
    const segmentPairs = await redis.sMembers(segmentIndexKey).catch(() => [] as string[]);

    if (segmentPairs.length === 0) {
      // Fallback: discover segments by scanning (with timeout protection)
      const comboSet = new Set<string>();
      try {
        for await (const key of redis.scanIterator({
          MATCH: `segments:${deviceId}:*:*:hourly`,
          COUNT: 200,
        })) {
          const match = String(key).match(
            new RegExp(`segments:${deviceId}:([^:]+):([^:]+):hourly`)
          );
          if (match) {
            comboSet.add(`${match[1]}:${match[2]}`);
          }
          // Safety limit
          if (comboSet.size >= 50) break;
        }
      } catch (scanError) {
        console.error("[Analyze] Error scanning segments:", scanError);
      }
      segmentPairs.push(...Array.from(comboSet));
    }

    // Fetch segment data for each category:subsection combination
    const maxHours = Math.min(Math.ceil(seconds / 3600), 168); // Max 7 days of hourly data
    const maxSegments = Math.min(segmentPairs.length, 50); // Limit to 50 segments to avoid timeout
    
    for (const pair of segmentPairs.slice(0, maxSegments)) {
      const [category, subsection] = pair.split(":");
      if (!category || !subsection) continue;

      try {
        const hourlyIndexKey = `segments:${deviceId}:${category}:${subsection}:hourly`;
        const hourlyKeys = await redis.zRange(
          hourlyIndexKey,
          minTimestamp,
          now,
          {
            BY: "SCORE",
            REV: true,
            LIMIT: { offset: 0, count: maxHours },
          }
        ).catch(() => []);

        // Fetch segment data in batch
        if (hourlyKeys.length > 0) {
          const pipeline = redis.multi();
          for (const hourKey of hourlyKeys) {
            // hourKey from index is the full key path: segment:device:category:subsection:hourly:YYYYMMDDHH
            // (note: actual key uses "segment:" singular, index uses "segments:" plural)
            let segmentKey: string;
            if (hourKey.includes(":")) {
              // Full key path (already correct format)
              segmentKey = hourKey;
            } else {
              // Just YYYYMMDDHH format - construct full key
              segmentKey = `segment:${deviceId}:${category}:${subsection}:hourly:${hourKey}`;
            }
            pipeline.hGetAll(segmentKey);
          }
          const results = await pipeline.exec().catch(() => []);

          for (let i = 0; i < hourlyKeys.length && i < (results?.length || 0); i++) {
            const hourKey = hourlyKeys[i];
            const result = results?.[i] as [Error | null, Record<string, string>] | null;
            
            // Handle Redis pipeline result format: [error, result] tuple
            if (!result) {
              continue;
            }
            
            // Check for error (result[0] is error, result[1] is data)
            const error = result[0];
            const segmentData = result[1];
            
            if (error || !segmentData || typeof segmentData !== "object" || Object.keys(segmentData).length === 0) {
              continue;
            }
            
            // Parse timestamp from hourKey or segmentData
            let timestamp = 0;
            try {
              // Try to get timestamp from segmentData first
              if (segmentData.timestamp) {
                timestamp = parseInt(segmentData.timestamp, 10) * 1000; // Convert to milliseconds
              } else {
                // Parse from hourKey (extract YYYYMMDDHH)
                let hourKeyStr = hourKey;
                if (hourKey.includes(":")) {
                  // Extract YYYYMMDDHH from full key path
                  const parts = hourKey.split(":");
                  hourKeyStr = parts[parts.length - 1];
                }
                
                if (hourKeyStr && hourKeyStr.length >= 10) {
                  const year = parseInt(hourKeyStr.substring(0, 4), 10);
                  const month = parseInt(hourKeyStr.substring(4, 6), 10) - 1;
                  const day = parseInt(hourKeyStr.substring(6, 8), 10);
                  const hour = parseInt(hourKeyStr.substring(8, 10), 10);
                  timestamp = Math.floor(
                    new Date(Date.UTC(year, month, day, hour, 0, 0)).getTime() / 1000
                  ) * 1000; // Convert to milliseconds
                }
              }
            } catch (e) {
              // Use current time as fallback
              timestamp = Date.now();
            }

            const avgScore = parseFloat(segmentData.avg_score || "0");
            const detectionCount = parseInt(segmentData.detection_count || "0", 10);
            const pointsSum = parseInt(segmentData.points_sum || "0", 10);

            // Only include signals with actual detections
            if (detectionCount > 0 || pointsSum > 0) {
              signals.push({
                category,
                name: `${category}:${subsection}`,
                status: avgScore >= 10 ? "ALERT" : avgScore >= 5 ? "WARN" : "INFO",
                details: `Detection count: ${detectionCount}, Points: ${pointsSum}, Avg score: ${avgScore.toFixed(1)}`,
                timestamp: timestamp || Date.now(),
              });
            }
          }
        }
      } catch (segmentError) {
        // Continue with other segments if one fails
        console.error(`[Analyze] Error fetching segment ${pair}:`, segmentError);
        continue;
      }
    }

    return signals;
  } catch (error) {
    console.error("[Analyze] Error fetching historical signals:", error);
    return [];
  } finally {
    try {
      await redis.disconnect();
    } catch {
      // Ignore disconnect errors - connection may already be closed
    }
  }
}

// Build comprehensive configuration context - optimized and cached
 
function buildConfigurationContext(allConfigs?: any): string {
  const configs: string[] = [];

  // Use allConfigs if provided, otherwise load individually (for backward compatibility)
  // Load programs registry
  const programsRegistry = allConfigs?.["programs_registry.json"] || loadConfigFile("programs_registry.json");
  if (programsRegistry?.programs) {
    const programsList: string[] = [];
     
    Object.entries(programsRegistry.programs).forEach(([name, info]: [string, any]) => {
      const points = info.points || 0;
      const status = points >= 15 ? "CRITICAL" : points >= 10 ? "ALERT" : points >= 5 ? "WARN" : "INFO";
      const description = info.description || "No description";
      // Truncate long descriptions
      const shortDesc = description.length > 100 ? description.substring(0, 100) + "..." : description;
      programsList.push(`  • ${info.label || name} (${info.type || "unknown"}): ${status} - ${shortDesc}`);
    });
    if (programsList.length > 0) {
      // Limit to top 80 most relevant (CRITICAL and ALERT first)
      const sorted = programsList.sort((a, b) => {
        const aCritical = a.includes("CRITICAL") ? 2 : a.includes("ALERT") ? 1 : 0;
        const bCritical = b.includes("CRITICAL") ? 2 : b.includes("ALERT") ? 1 : 0;
        return bCritical - aCritical;
      });
      configs.push(`KNOWN PROGRAMS REGISTRY (${sorted.length} programs):\n${sorted.slice(0, 80).join("\n")}`);
    }
  }

  // Load behavior config
  const behaviorConfig = allConfigs?.["behaviour_config.json"] || loadConfigFile("behaviour_config.json");
  if (behaviorConfig?.thresholds) {
    const thresholds = {
      iki_cv_alert: behaviorConfig.thresholds.iki_cv_alert,
      ici_cv_alert: behaviorConfig.thresholds.ici_cv_alert,
      const_velocity_alert: behaviorConfig.thresholds.const_velocity_alert,
      min_reaction_ms: behaviorConfig.thresholds.min_reaction_ms,
    };
    configs.push(`BEHAVIOR DETECTION THRESHOLDS:\n${JSON.stringify(thresholds, null, 2)}`);
  }

  // Load network config - only suspicious patterns
  const networkConfig = allConfigs?.["network_config.json"] || loadConfigFile("network_config.json");
  if (networkConfig?.suspicious_patterns) {
    const patterns: string[] = [];
     
    Object.entries(networkConfig.suspicious_patterns).forEach(([pattern, info]: [string, any]) => {
      if (info.status === "ALERT" || info.status === "CRITICAL") {
        patterns.push(`  • ${pattern}: ${info.name || pattern} (${info.status})`);
      }
    });
    if (patterns.length > 0) {
      configs.push(`NETWORK PATTERNS (${patterns.length} patterns):\n${patterns.slice(0, 30).join("\n")}`);
    }
  }

  // Load screen config - simplified
  const screenConfig = allConfigs?.["screen_config.json"] || loadConfigFile("screen_config.json");
  if (screenConfig?.overlay_detection) {
    const overlays = (screenConfig.overlay_detection.overlay_classes || []).slice(0, 10);
    const hudPatterns = (screenConfig.overlay_detection.hud_overlay_patterns || []).slice(0, 10);
    configs.push(`SCREEN MONITORING:\n  Overlay Classes: ${overlays.join(", ")}\n  HUD Patterns: ${hudPatterns.join(", ")}`);
  }

  // Load VM config - only high-risk processes
  const vmConfig = allConfigs?.["vm_config.json"] || loadConfigFile("vm_config.json");
  if (vmConfig?.vm_processes) {
    const vmProcesses: string[] = [];
     
    Object.entries(vmConfig.vm_processes).forEach(([_vendor, processes]: [string, any]) => {
       
      Object.entries(processes).forEach(([process, info]: [string, any]) => {
        if ((info.points || 0) >= 10) {
          vmProcesses.push(`  • ${process}: ${info.name || process} (${info.points || 0} points)`);
        }
      });
    });
    if (vmProcesses.length > 0) {
      configs.push(`VM DETECTION (High-risk only, ${vmProcesses.length} processes):\n${vmProcesses.slice(0, 30).join("\n")}`);
    }
  }

  return configs.join("\n\n");
}

export async function POST(request: NextRequest) {
  try {
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return successResponse(
        {
          analysis:
            "AI analysis service is currently unavailable. The OPENAI_API_KEY environment variable is not configured. Please contact your administrator to enable AI-powered bot detection analysis.",
          model: "none",
          threatLevel: 0,
          signalCount: 0,
        },
        503,
        { cache: "no-store" }
      );
    }

    const openai = getOpenAI();
    // Parse JSON body safely
    const parsed = await parseJsonBody(request);
    if (!parsed.success) {
      return errorResponse(parsed.error, 400);
    }

    const data = parsed.data as {
      deviceId?: string;
      signals?: unknown[];
      threatLevel?: number;
      categoryThreats?: Record<string, number>;
      stats?: Record<string, unknown>;
      timePreset?: string;
      modelHint?: string;
    };
    const {
      deviceId,
      signals: currentSignals,
      threatLevel,
      categoryThreats,
      stats,
      timePreset = "24h",
      modelHint = "auto",
    } = data;
    const currentSignalsCount = currentSignals?.length ?? 0;

    // Validate timePreset
    if (!TIME_PRESETS[timePreset]) {
      return errorResponse(`Invalid timePreset: ${timePreset}. Valid values: ${Object.keys(TIME_PRESETS).join(", ")}`, 400);
    }

    // Validate deviceId if provided
    if (deviceId && (typeof deviceId !== "string" || deviceId.trim().length === 0)) {
      return errorResponse("Invalid deviceId provided", 400);
    }

    // Get historical signals if deviceId and timePreset are provided
     
    let historicalSignals: any[] = [];
    if (deviceId && timePreset) {
      try {
        historicalSignals = await getHistoricalSignals(deviceId, timePreset);
        console.log(`[Analyze] Fetched ${historicalSignals.length} historical signals for device ${deviceId} over ${timePreset}`);
      } catch (error) {
        console.error("[Analyze] Error fetching historical signals:", error);
        // Continue with current signals only
      }
    }

    // Combine current and historical signals
    let allSignals = [
      ...(currentSignals || []),
      ...historicalSignals,
    ];

    let usedSyntheticSignals = false;
    if ((!allSignals || allSignals.length === 0) && categoryThreats) {
      const syntheticSignals = buildSyntheticSignalsFromCategories(
        categoryThreats,
      );
      if (syntheticSignals.length) {
        allSignals = syntheticSignals;
        usedSyntheticSignals = true;
      }
    }

    if (!allSignals || allSignals.length === 0) {
      return successResponse(
        {
          analysis:
            "Inga detektioner hittades för valt tidsfönster. Kör en längre period eller vänta på nya signaler.",
          model: "not-run",
          threatLevel: threatLevel ?? 0,
          signalCount: 0,
          historicalSignalCount: 0,
          timePreset,
        },
        200,
        { cache: "no-store" },
      );
    }

    // Load configuration context - use loadAllConfigs to include all config files
    const allConfigs = loadAllConfigs();
    const configurationContext = buildConfigurationContext(allConfigs);

    // Build enhanced detection context with detailed explanations
    const detectionContext = buildDetectionContext(allSignals);
    const categorizedSignals = categorizeSignals(allSignals);

    // Extract program-specific explanations for detected programs
    const programDetails: string[] = [];
    const uniquePrograms = new Set<string>();

    allSignals.forEach((signal) => {
      if (
        signal.category === "programs" &&
        signal.name &&
        !uniquePrograms.has(signal.name)
      ) {
        uniquePrograms.add(signal.name);
        const explanation = getProgramExplanation(signal.name);
        if (explanation) {
          programDetails.push(`  • ${signal.name}: ${explanation}`);
        }
      }
    });

    const now = Date.now();
    const timeRanges = {
      lastHour: allSignals.filter((s) => s.timestamp && s.timestamp > now - 3600000).length,
      last24Hours: allSignals.filter((s) => s.timestamp && s.timestamp > now - 86400000).length,
      last7Days: allSignals.filter((s) => s.timestamp && s.timestamp > now - 7 * 86400000).length,
    };

    const topSignals = summarizeTopSignals(allSignals, 8);
    const summaryTimePreset = usedSyntheticSignals
      ? `${timePreset} (syntetisk kategori-sammanställning)`
      : timePreset;
    const summaryBlock = buildAnalysisSummary({
      deviceId,
      timePreset: summaryTimePreset,
      threatLevel,
      categoryThreats,
      stats,
      timeRanges,
      topSignals,
      programDetails,
      totalSignals: allSignals.length,
      currentSignalsCount,
      historicalSignalsCount: historicalSignals.length,
      categorizedSnapshot: categorizedSignals,
    });

    const condensedConfig =
      configurationContext.length > 2000
        ? `${configurationContext.slice(0, 2000)}\n...truncated...`
        : configurationContext;

    const prompt = `${summaryBlock}

Konfigsnapshot (trimmat):
${condensedConfig}

Detektionskontext:
${detectionContext}

Programregister-noteringar:
${programDetails.slice(0, 8).join("\n") || "Inga"}

Instruktion:
- Cheat Verdict (High/Medium/Low + klassificering: bot, RTA, macro, overlay eller ren).
- Key Evidence (punktlista med direkta detektioner/konfigtrösklar).
- Recommended Action.
Max 2200 tecken, skriv på svenska och håll det koncist.`;

    // Try different models with fallback
    let analysis = "";
    let modelUsed = "";

    const validModelNames = MODEL_PREFERENCE.map((m) => m.name);
    const modelsToTry =
      modelHint && modelHint !== "auto"
        ? validModelNames.includes(modelHint)
          ? [{ name: modelHint, maxTokens: 3600 }]
          : MODEL_PREFERENCE
        : MODEL_PREFERENCE;

    for (const model of modelsToTry) {
      try {
        console.log(`[Analyze] Trying model: ${model.name}`);
        const response = await openai.responses.create({
          model: model.name,
          input: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: prompt,
                },
              ],
            },
          ],
          max_output_tokens: model.maxTokens,
        });

        const outputText =
          response.output
            ?.flatMap((item: any) => {
              // Handle different response output formats
              if (item.content && Array.isArray(item.content)) {
                return item.content
                  .filter(
                    (chunk: any) =>
                      chunk.type === "output_text" || chunk.type === "text",
                  )
                  .map((chunk: any) => chunk.text || chunk.output_text || "");
              } else if (item.text) {
                return [item.text];
              } else if (item.output_text) {
                return [item.output_text];
              }
              return [];
            })
            .join("\n")
            .trim() || "";

        if (outputText) {
          analysis = outputText;
          modelUsed = model.name;
          console.log(`[Analyze] Success with model: ${model.name}`);
          break;
        }
      } catch (modelError: any) {
        console.error(
          `[Analyze] Model ${model.name} failed:`,
          modelError.message || modelError,
        );
        if (
          modelError.message?.includes("API key") ||
          modelError.message?.includes("authentication")
        ) {
          throw new Error("OpenAI API key is invalid eller ogiltig");
        }
      }
    }

    if (!analysis) {
      throw new Error("All models failed. Please check your OpenAI API key and try again.");
    }

    return successResponse(
      {
        analysis,
        model: modelUsed,
        threatLevel,
        signalCount: allSignals.length,
        historicalSignalCount: historicalSignals.length,
        timePreset,
      },
      200,
      { cache: "no-store" },
    );
  } catch (error) {
    console.error("[Analyze] Analysis error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to analyze signals",
      500
    );
  }
}
