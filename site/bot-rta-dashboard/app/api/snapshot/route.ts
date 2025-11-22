import { NextRequest } from "next/server";
import { getSnapshot, getCachedSnapshot } from "@/lib/store";
import { successResponse, errorResponse } from "@/lib/api-utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get("device") || undefined;
    const useCached = searchParams.get("cached") === "true";

    let snap;

    // Try cached snapshot first if requested and device_id is provided
    if (useCached && deviceId) {
      const cached = await getCachedSnapshot(deviceId);
      if (cached) {
        if (process.env.NODE_ENV !== "production") {
          console.log(`[API] Serving cached snapshot for device ${deviceId}`);
        }
        snap = cached;
      } else {
        if (process.env.NODE_ENV !== "production") {
          console.log(
            `[API] Cache miss for device ${deviceId}, building fresh snapshot`
          );
        }
        snap = await getSnapshot(deviceId);
      }
    } else {
      snap = await getSnapshot(deviceId);
    }

    const wasCached = Boolean((snap as any)?.cached);

    return successResponse(snap, 200, {
      headers: {
        "Cache-Control":
          useCached && wasCached
            ? "public, s-maxage=30, stale-while-revalidate=60"
            : "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err: any) {
    console.error("[API /api/snapshot] Error:", err);
    return errorResponse(err, 500);
  }
}
