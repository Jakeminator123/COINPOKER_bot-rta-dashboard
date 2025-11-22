import { NextRequest } from 'next/server';
import { withRedis } from '@/lib/redis/redis-client';
import { redisKeys } from "@/lib/redis/schema";
import { successResponse, errorResponse } from '@/lib/utils/api-utils';
import { parseDeviceInfo } from '@/lib/device/device-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const result = await withRedis(async (client) => {

    // Get all devices
    const deviceKeys = await client.keys('device:*:info');
    const devices = [];

    for (const key of deviceKeys) {
      const deviceId = key.split(':')[1];
      const deviceData = await client.hGetAll(key);

      // Get recent signals for device info parsing
      const signalKeys = await client.keys(`signals:${deviceId}:*`);
      const recentSignals = [];

      for (const signalKey of signalKeys.slice(0, 100)) {
        try {
          const signalData = await client.get(signalKey);
          if (signalData) {
            recentSignals.push(JSON.parse(signalData));
          }
        } catch {
          // Ignore individual device processing errors
        }
      }

      // Parse device platform/OS info
      const deviceInfo = parseDeviceInfo(recentSignals);

      // Get threat statistics
      const threatStats = await client.hGetAll(`device:${deviceId}:threats`);
      const topThreats = Object.entries(threatStats)
        .map(([name, data]: [string, any]) => {
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          return {
            name,
            count: parsed.count || 0,
            severity: parsed.severity || 'WARN',
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Get activity pattern (hourly distribution)
      const activityPattern = [];
      for (let hour = 0; hour < 24; hour++) {
        const hourKey = `activity:${deviceId}:hour:${hour}`;
        const count = await client.get(hourKey);
        if (count) {
          activityPattern.push({ hour, count: parseInt(count) });
        }
      }

      // Get IP addresses
      const ipSet = await client.sMembers(`device:${deviceId}:ips`);

      // Determine risk factors
      const riskFactors = [];
      if (deviceInfo.isEmulator) riskFactors.push('Emulator');
      if (deviceInfo.isVM) riskFactors.push('Virtual Machine');
      if (topThreats.some(t => t.severity === 'CRITICAL')) riskFactors.push('Critical Threats');
      if (parseFloat(deviceData.threat_level || '0') > 75) riskFactors.push('High Risk');

      // Get session data
      const sessionKeys = await client.keys(redisKeys.sessionPattern(deviceId));
      const totalSessions = sessionKeys.length;
      let totalDuration = 0;
      let firstSeen = Date.now() / 1000;

      for (const sessionKey of sessionKeys) {
        const sessionData = await client.hGetAll(sessionKey);
        if (sessionData.duration) {
          totalDuration += parseInt(sessionData.duration);
        }
        if (sessionData.start_time) {
          const startTime = parseInt(sessionData.start_time);
          if (startTime < firstSeen) {
            firstSeen = startTime;
          }
        }
      }

      const avgSessionDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;

      const rawLastSeen = parseInt(deviceData.last_seen || '0');
      const lastSeenMs =
        rawLastSeen > 1_000_000_000_000 ? rawLastSeen : rawLastSeen * 1000;

      devices.push({
        device_id: deviceId,
        device_name: deviceData.device_name || deviceId.split('_')[0],
        last_seen: lastSeenMs,
        first_seen: firstSeen,
        is_online: deviceData.is_online === 'true',
        threat_level: parseFloat(deviceData.threat_level || '0'),
        total_detections: parseInt(deviceData.total_detections || '0'),
        total_sessions: totalSessions,
        avg_session_duration: avgSessionDuration,
        ip_addresses: Array.from(ipSet),
        device_info: deviceInfo,
        risk_factors: riskFactors,
        top_threats: topThreats,
        activity_pattern: activityPattern,
      });
    }

      return {
        devices,
        total: devices.length,
      };
    });

    return successResponse(result);
  } catch (error: any) {
    console.error('[devices/enhanced] Error:', error);
    return errorResponse(error.message || 'Failed to fetch device data', 500);
  }
}
