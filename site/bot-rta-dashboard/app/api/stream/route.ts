import { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const { searchParams } = new URL(req.url);
  const deviceId = searchParams.get("device") || undefined;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const safeEnqueue = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };

      // Adaptive polling with Redis pub/sub for instant updates
      let lastDataHash: string = "";
      let currentInterval = 2000; // Start with 2s (faster initial response)
      let inactivityCount = 0;
      const ACTIVE_INTERVAL = 2000; // 2 seconds when active
      const INACTIVE_INTERVAL = 10000; // 10 seconds when inactive
      const INACTIVITY_THRESHOLD = 5; // Switch to slow polling after 5 unchanged updates

      // Simple hash function for change detection
      const createHash = (str: string): string => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = (hash << 5) - hash + char;
          hash = hash & hash;
        }
        return hash.toString(36);
      };

      let tick: NodeJS.Timeout;
      let redisSubscriber: any = null;

      // Subscribe to Redis pub/sub for instant updates
      const setupRedisSubscription = async () => {
        try {
          const { createClient } = await import('redis');
          redisSubscriber = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
          });

          await redisSubscriber.connect();

          const channel = deviceId ? `updates:${deviceId}` : 'updates:all';
          await redisSubscriber.subscribe(channel, async (_message: string) => {
            // Send update immediately when Redis publishes
            if (!closed) {
              const snap = await getSnapshot(deviceId);
              const snapJson = JSON.stringify(snap);
              safeEnqueue(`data: ${snapJson}\n\n`);
              lastDataHash = createHash(snapJson);
              inactivityCount = 0; // Reset inactivity counter
              currentInterval = ACTIVE_INTERVAL;
            }
          });
        } catch (error) {
          console.error('[SSE] Redis subscription failed:', error);
          // Continue with polling fallback
        }
      };

      const send = async () => {
        const snap = await getSnapshot(deviceId);
        const snapJson = JSON.stringify(snap);
        const snapHash = createHash(snapJson);

        // Only send if data has changed
        if (snapHash !== lastDataHash) {
          safeEnqueue(`data: ${snapJson}\n\n`);
          lastDataHash = snapHash;
          inactivityCount = 0;
          currentInterval = ACTIVE_INTERVAL;
        } else {
          inactivityCount++;
          if (inactivityCount >= INACTIVITY_THRESHOLD) {
            currentInterval = INACTIVE_INTERVAL;
          }
        }

        // Schedule next poll with adaptive interval
        if (!closed) {
          clearTimeout(tick);
          tick = setTimeout(send, currentInterval);
        }
      };

      // Setup Redis subscription for instant updates
      setupRedisSubscription();

      // Initial send
      send();

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        if (!closed) {
          safeEnqueue(`:heartbeat\n\n`);
        } else {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on close
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearTimeout(tick);
        clearInterval(heartbeat);
        if (redisSubscriber) {
          redisSubscriber.disconnect().catch(() => {});
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering
      "Access-Control-Allow-Origin": "*",
    },
  });
}
