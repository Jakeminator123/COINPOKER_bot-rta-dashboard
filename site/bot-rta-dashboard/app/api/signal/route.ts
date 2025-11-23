import { NextRequest } from "next/server";
import { addSignal, addSignals } from "@/lib/utils/store";
import type { Signal } from "@/lib/detections/sections";
import {
  successResponse,
  errorResponse,
  corsOptions,
  validateToken,
  parseJsonBody,
  getClientIP,
} from "@/lib/utils/api-utils";
import { signalLimiter } from "@/lib/rate-limiter";
import { validateSignalPayload } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Throttle non-batch signals to prevent spam
// Only batch reports (every 92s) should be processed for player list
// Other signals are only needed for individual player dashboards (memory store)
const SIGNAL_THROTTLE_MS = 3000; // 3 seconds minimum between non-batch signals per device
const lastSignalTime = new Map<string, number>();

type Payload = {
  v?: number;
  ts?: number;
  timestamp?: number;
  env?: string;
  host?: string;
  category?: string;
  section?: string;
  name?: string;
  status?: string;
  details?: string;
  type?: string;
  device_id?: string;
  device_name?: string;
  device_ip?: string;
  segment_name?: string;
};

// Use a global in-memory store (persists while dev server stays hot)
const g: any = globalThis as any;
if (!g.__msgs) g.__msgs = [] as Payload[];

// Normalize incoming payload to Signal format
function normalizeToSignal(p: Payload): Signal {
  const timestamp = p.ts || p.timestamp || Date.now() / 1000;
  const category = p.category || p.section || "unknown";
  const status = (p.status || "INFO").toUpperCase();
  const device_id = p.device_id || p.host || "unknown";
  const device_name = p.device_name || p.host || device_id;
  const device_ip = (p as any).device_ip as string | undefined;

  return {
    timestamp,
    category,
    name: p.name || "Unknown",
    status: status as any,
    details: p.details || "",
    device_id,
    device_name,
    device_ip,
    segment_name: (p as any).segment_name,
  };
}

export async function OPTIONS() {
  return corsOptions();
}

export async function POST(req: NextRequest) {
  try {
    // Rate limiting check
    const clientIP = getClientIP(req) || "unknown";
    if (!signalLimiter.isAllowed(clientIP)) {
      return errorResponse("Rate limit exceeded. Max 100 requests per minute.", 429, {
        "Retry-After": "60",
        "X-RateLimit-Limit": "100",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": new Date(Date.now() + 60000).toISOString(),
      });
    }
    
    // Check bearer token if SIGNAL_TOKEN is set
    const signalToken = process.env.SIGNAL_TOKEN;
    const tokenValidation = validateToken(req, signalToken);
    if (!tokenValidation.valid) {
      console.warn(
        "[/api/signal] Unauthorized request:",
        tokenValidation.error
      );
      return errorResponse("Unauthorized", 401);
    }

    // Handle empty requests gracefully
    const contentLength = req.headers.get("content-length");
    if (contentLength === "0") {
      if (process.env.NODE_ENV !== "production") {
        console.log("[/api/signal] Empty request received (heartbeat?)");
      }
      return successResponse({ received: 0 });
    }

    // Parse JSON body safely
    const parsed = await parseJsonBody(req);
    if (!parsed.success) {
      if (parsed.error === "Empty request body") {
        if (process.env.NODE_ENV !== "production") {
          console.log("[/api/signal] Empty body received");
        }
        return successResponse({ received: 0 });
      }
      console.error("[/api/signal] Invalid JSON:", parsed.error);
      return errorResponse(parsed.error, 400);
    }

    const rawBody = parsed.data;
    const ip = getClientIP(req);

    // Handle both single signal and batch, inject device_ip
    const items: Payload[] = Array.isArray(rawBody) ? rawBody : [rawBody];
    const itemsWithIp: Payload[] = items.map((it) => ({
      ...it,
      device_ip: (it as any).device_ip || ip,
    }));

    // Process each signal
    const signals: Signal[] = [];
    for (const item of itemsWithIp) {
      if (!item.ts && !item.timestamp) {
        item.ts = Date.now() / 1000;
      }

      // Store raw for backward compatibility
      g.__msgs.push(item);
      if (g.__msgs.length > 1000) {
        g.__msgs.splice(0, g.__msgs.length - 1000);
      }

      // Convert to Signal and add to store
      const signal = normalizeToSignal(item);

      // Check if this is a batch report (should always be processed)
      const isBatchReport = signal.category === "system" && signal.name.includes("Scan Report");
      
      // Throttle non-batch signals - only process if enough time has passed
      // This prevents spam from test/localhost signals
      // Batch reports (every 92s) are always processed, but other signals are throttled
      if (!isBatchReport && signal.device_id) {
        const deviceKey = signal.device_id;
        const lastTime = lastSignalTime.get(deviceKey) || 0;
        const now = Date.now();
        
        if (now - lastTime < SIGNAL_THROTTLE_MS) {
          // Skip this signal - too frequent
          // Only batch reports should be processed frequently
          // Individual player dashboards use MemoryStore which has its own throttling
          continue;
        }
        
        lastSignalTime.set(deviceKey, now);
      }

      // Simplified batch logging - only essential info
      if (isBatchReport) {
        try {
          const batchData = JSON.parse(signal.details || "{}");
          console.log("[/api/signal] Batch received:", {
            device: signal.device_id,
            name: signal.device_name,
            batch_number: batchData.batch_number,
            bot_probability: batchData.bot_probability,
            threats: batchData.aggregated_threats?.length || batchData.threats?.length || 0,
            nickname: batchData.nickname,
            timestamp: signal.timestamp,
          });
        } catch (err) {
          console.error("[/api/signal] Failed to parse batch:", err);
        }
      }

      // Log Player Name Detected signals for debugging
      if (signal.name === "Player Name Detected" && process.env.NODE_ENV !== "production") {
        console.log("[/api/signal] Player Name Detected signal:", {
          device_id: signal.device_id,
          device_name: signal.device_name,
          device_ip: signal.device_ip,
          details: signal.details,
          category: signal.category,
        });
      }

      // Extract and save SHA256 to database if present
      if (signal.details && signal.category === "programs") {
        // Format: "SHA:{sha256} | {exe_name} | {comment} | {source} | Path:{file_path}"
        const shaMatch = signal.details.match(/SHA:([a-fA-F0-9]{64})/);
        if (shaMatch) {
          const sha256 = shaMatch[1].toLowerCase();
          
          // Extract program name (first part after SHA)
          const parts = signal.details.split("|").map((p) => p.trim());
          const programName = parts.length > 1 ? parts[1] : signal.name;

          // Save to SHA database (fire and forget - don't block signal processing)
          fetch(`${req.nextUrl.origin}/api/sha-database`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.SIGNAL_TOKEN || "detector-secret-token-2024"}`,
            },
            body: JSON.stringify({
              sha256: sha256,
              program_name: programName,
            }),
          }).catch((err) => {
            // Silently fail - SHA database is optional
            if (process.env.NODE_ENV !== "production") {
              console.warn("[/api/signal] Failed to save SHA to database:", err);
            }
          });
        }
      }

      signals.push(signal);
    }

    // Add to the store that devices API reads from
    if (signals.length > 1) {
      addSignals(signals);
    } else if (signals.length === 1) {
      addSignal(signals[0]);
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("[/api/signal] Received:", items.length, "signal(s)");
    }
    return successResponse({ received: items.length }, 200, {
      cache: "no-store",
    });
  } catch (e: any) {
    console.error("[/api/signal] Error:", e);
    return errorResponse(e, 500);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const host = searchParams.get("host");
    const since = Number(searchParams.get("since") || 0);
    const msgs: Payload[] = (globalThis as any).__msgs || [];
    const filtered = msgs.filter(
      (m) => (!host || m.host === host) && (m.ts ?? 0) > since
    );
    return successResponse({ messages: filtered }, 200, { cache: "no-store" });
  } catch (err: any) {
    return errorResponse(err, 500);
  }
}
