import { NextRequest } from "next/server";
import { getHourlyAggregates } from "@/lib/store";
import { successResponse, errorResponse } from "@/lib/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Input validation constants
// MAX_HOURS matches Redis TTL - data older than this is automatically cleaned up
// Reads from REDIS_TTL_SECONDS env var (default: 7 days = 604800 seconds)
const REDIS_TTL_SECONDS = Number(process.env.REDIS_TTL_SECONDS) || 604800;
const MIN_HOURS = 1;
const MAX_HOURS = Math.ceil(REDIS_TTL_SECONDS / 3600); // Convert seconds to hours
const MIN_MINUTES = 1;
const MAX_MINUTES = 1440; // 24 hours

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const device = searchParams.get("device");
    const hoursParam = searchParams.get("hours");
    const minutesParam = searchParams.get("minutes");

    // Input validation
    if (!device || typeof device !== "string" || device.trim().length === 0) {
      return errorResponse("device parameter required", 400);
    }

    // Parse and validate parameters
    let hours: number;
    let minutesOverride: number | undefined;

    if (minutesParam) {
      const minutes = parseInt(minutesParam, 10);
      if (isNaN(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
        return errorResponse(`minutes must be between ${MIN_MINUTES} and ${MAX_MINUTES}`, 400);
      }
      // Convert minutes to hours (rounded up) for backend logic
      // But pass minutes as override so backend uses exact minutes
      hours = Math.max(MIN_HOURS, Math.ceil(minutes / 60));
      minutesOverride = minutes;
    } else {
      hours = hoursParam ? parseInt(hoursParam, 10) : 24;
      if (isNaN(hours) || hours < MIN_HOURS || hours > MAX_HOURS) {
        return errorResponse(`hours must be between ${MIN_HOURS} and ${MAX_HOURS}`, 400);
      }
    }

    const aggregates = await getHourlyAggregates(device, hours, minutesOverride);

    // Validate aggregates is an array
    if (!Array.isArray(aggregates)) {
      console.error("[API /api/history/hourly] Invalid aggregates format:", typeof aggregates);
      return errorResponse("Invalid data format returned from database", 500);
    }

    return successResponse(
      {
        device,
        hours: aggregates,
        total: aggregates.length,
      },
      200,
      { cache: "no-store" }
    );
  } catch (error) {
    console.error("[API /api/history/hourly] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch hourly aggregates",
      500
    );
  }
}
