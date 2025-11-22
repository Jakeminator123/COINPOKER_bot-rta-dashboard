/**
 * Hook for fetching session data from API
 * Used for session filtering and visualization in charts
 */

import { useMemo } from "react";
import useSWR from "swr";

export interface Session {
  session_start: number; // Unix timestamp in seconds
  session_end: number; // Unix timestamp in seconds (0 if ongoing)
  session_duration_seconds: number;
  event_type: "login" | "logout" | "unknown";
  final_threat_score: number;
  final_bot_probability: number;
  segments?: Array<{
    category: string;
    subsection: string;
    avg_score: number;
    total_detections: number;
    points_sum: number;
  }>;
  // Extended fields added during processing
  startDate?: Date;
  endDate?: Date | null;
  durationMinutes?: number;
  isActive?: boolean;
}

interface SessionDataResponse {
  device: string;
  since: number;
  count: number;
  sessions: Session[];
}

const fetcher = async (url: string): Promise<SessionDataResponse> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.data || data;
  } catch (error) {
    console.error(`[useSessionData] Fetch error for ${url}:`, error);
    throw error;
  }
};

export function useSessionData(
  deviceId: string | null | undefined,
  timeRangeSeconds?: number
) {
  // Calculate since timestamp (default: last 30 days)
  const since = useMemo(() => {
    if (timeRangeSeconds) {
      return Math.floor((Date.now() / 1000) - timeRangeSeconds);
    }
    return Math.floor((Date.now() / 1000) - (30 * 24 * 3600)); // 30 days default
  }, [timeRangeSeconds]);

  const sessionApiUrl = useMemo(
    () =>
      deviceId
        ? `/api/history/session?device=${encodeURIComponent(deviceId)}&since=${since}&limit=100`
        : null,
    [deviceId, since]
  );

  const { data, error, isLoading } = useSWR<SessionDataResponse>(
    sessionApiUrl,
    fetcher,
    {
      refreshInterval: 60000, // Refresh every minute
      dedupingInterval: 30000,
      revalidateOnFocus: false,
      onError: (error) => {
        console.error("[useSessionData] Error fetching session data:", error);
      },
    }
  );

  // Process sessions to create complete session objects (pair login/logout)
  const processedSessions = useMemo(() => {
    if (!data?.sessions) return [];

    const sessions: Array<Session & { 
      startDate: Date; 
      endDate: Date | null;
      durationMinutes: number;
      isActive: boolean;
    }> = [];

    // Group sessions by login/logout pairs
    const loginSessions = new Map<number, Session>();
    const logoutSessions = new Map<number, Session>();

    data.sessions.forEach((session) => {
      if (session.event_type === "login") {
        loginSessions.set(session.session_start, session);
      } else if (session.event_type === "logout") {
        logoutSessions.set(session.session_start, session);
      }
    });

    // Create complete session objects
    loginSessions.forEach((loginSession, sessionStart) => {
      const logoutSession = logoutSessions.get(sessionStart);
      const sessionEnd = logoutSession?.session_end || 0;
      const duration = logoutSession?.session_duration_seconds || 
        (sessionEnd > 0 ? sessionEnd - sessionStart : 0);

      sessions.push({
        ...loginSession,
        session_end: sessionEnd,
        session_duration_seconds: duration,
        startDate: new Date(sessionStart * 1000),
        endDate: sessionEnd > 0 ? new Date(sessionEnd * 1000) : null,
        durationMinutes: Math.floor(duration / 60),
        isActive: sessionEnd === 0,
      });
    });

    // Sort by start time (most recent first)
    return sessions.sort((a, b) => b.session_start - a.session_start);
  }, [data]);

  return {
    sessions: processedSessions,
    isLoading,
    error,
    rawData: data,
  };
}

