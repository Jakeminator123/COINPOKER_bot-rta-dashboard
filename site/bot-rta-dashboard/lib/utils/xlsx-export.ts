import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

export interface SegmentData {
  category: string;
  subsection: string;
  timestamp: number;
  avg_score: number;
  total_detections: number;
  points_sum: number;
  time_label: string;
}

export interface SessionData {
  session_start: number;
  session_end: number;
  session_duration_seconds: number;
  event_type: string;
  final_threat_score: number;
  final_bot_probability: number;
  segments: Array<{
    category: string;
    subsection: string;
    avg_score: number;
    total_detections: number;
    points_sum: number;
  }>;
}

/**
 * Export player segment data to XLSX format (returns buffer for download)
 */
export async function exportPlayerSegmentsToXLSX(
  deviceId: string,
  deviceName: string,
  hourlyData: SegmentData[],
  dailyData: SegmentData[],
  sessionData: SessionData[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Add metadata
  workbook.creator = 'Bot RTA Detection System';
  workbook.created = new Date();

  // Sheet 1: Hourly Reports
  if (hourlyData.length > 0) {
    const hourlySheet = workbook.addWorksheet('Hourly Reports');
    hourlySheet.columns = [
      { header: 'Timestamp', key: 'timestamp', width: 25 },
      { header: 'Time', key: 'time', width: 20 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Subsection', key: 'subsection', width: 20 },
      { header: 'Avg Score (%)', key: 'avgScore', width: 15 },
      { header: 'Total Detections', key: 'totalDetections', width: 18 },
      { header: 'Points Sum', key: 'pointsSum', width: 12 },
    ];

    // Add header row styling
    hourlySheet.getRow(1).font = { bold: true };
    hourlySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    hourlyData.forEach(data => {
      hourlySheet.addRow({
        timestamp: new Date(data.timestamp * 1000).toISOString(),
        time: data.time_label,
        category: data.category,
        subsection: data.subsection,
        avgScore: Math.round(data.avg_score * 100) / 100,
        totalDetections: data.total_detections,
        pointsSum: data.points_sum,
      });
    });
  }

  // Sheet 2: Daily Reports
  if (dailyData.length > 0) {
    const dailySheet = workbook.addWorksheet('Daily Reports');
    dailySheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Subsection', key: 'subsection', width: 20 },
      { header: 'Avg Score (%)', key: 'avgScore', width: 15 },
      { header: 'Total Detections', key: 'totalDetections', width: 18 },
      { header: 'Points Sum', key: 'pointsSum', width: 12 },
    ];

    // Add header row styling
    dailySheet.getRow(1).font = { bold: true };
    dailySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    dailyData.forEach(data => {
      dailySheet.addRow({
        date: data.time_label,
        category: data.category,
        subsection: data.subsection,
        avgScore: Math.round(data.avg_score * 100) / 100,
        totalDetections: data.total_detections,
        pointsSum: data.points_sum,
      });
    });
  }

  // Sheet 3: Session Reports
  if (sessionData.length > 0) {
    const sessionSheet = workbook.addWorksheet('Session Reports');

    // Add header row styling
    sessionSheet.getRow(1).font = { bold: true };
    sessionSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    sessionSheet.columns = [
      { header: 'Session Start', key: 'sessionStart', width: 25 },
      { header: 'Session End', key: 'sessionEnd', width: 25 },
      { header: 'Duration (min)', key: 'duration', width: 15 },
      { header: 'Event Type', key: 'eventType', width: 15 },
      { header: 'Final Threat Score', key: 'threatScore', width: 18 },
      { header: 'Final Bot Probability (%)', key: 'botProbability', width: 22 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Subsection', key: 'subsection', width: 20 },
      { header: 'Avg Score (%)', key: 'avgScore', width: 15 },
      { header: 'Total Detections', key: 'totalDetections', width: 18 },
    ];

    for (const session of sessionData) {
      const sessionStart = new Date(session.session_start).toISOString();
      const sessionEnd = session.session_end > 0
        ? new Date(session.session_end).toISOString()
        : 'Active';
      const durationMinutes = Math.floor(session.session_duration_seconds / 60);

      if (session.segments.length === 0) {
        sessionSheet.addRow({
          sessionStart,
          sessionEnd,
          duration: durationMinutes,
          eventType: session.event_type,
          threatScore: session.final_threat_score,
          botProbability: session.final_bot_probability,
          category: '',
          subsection: '',
          avgScore: 0,
          totalDetections: 0,
        });
      } else {
        for (const segment of session.segments) {
          sessionSheet.addRow({
            sessionStart,
            sessionEnd,
            duration: durationMinutes,
            eventType: session.event_type,
            threatScore: session.final_threat_score,
            botProbability: session.final_bot_probability,
            category: segment.category,
            subsection: segment.subsection,
            avgScore: Math.round(segment.avg_score * 100) / 100,
            totalDetections: segment.total_detections,
          });
        }
      }
    }
  }

  // Convert workbook to buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Save XLSX file to exports directory (for local development)
 * Saves to site/exports/ directory (next to bot-rta-dashboard)
 */
export async function saveXLSXToFile(
  deviceId: string,
  deviceName: string,
  hourlyData: SegmentData[],
  dailyData: SegmentData[],
  sessionData: SessionData[]
): Promise<string> {
  // Determine exports directory: site/exports/ (next to bot-rta-dashboard)
  // Use process.cwd() which points to bot-rta-dashboard/ in both dev and production
  const projectRoot = process.cwd(); // bot-rta-dashboard/
  const siteDir = path.resolve(projectRoot, '..'); // site/
  const exportsDir = path.join(siteDir, 'exports');

  // Create exports directory if it doesn't exist
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const filename = generateExportFilename(deviceId, deviceName, 'daily');
  const filepath = path.join(exportsDir, filename);

  const buffer = await exportPlayerSegmentsToXLSX(
    deviceId,
    deviceName,
    hourlyData,
    dailyData,
    sessionData
  );

  // Write file with error handling
  try {
    fs.writeFileSync(filepath, buffer);
    console.log(`[xlsx-export] Successfully saved file: ${filepath} (${buffer.length} bytes)`);

    // Verify file was created
    if (fs.existsSync(filepath)) {
      const stats = fs.statSync(filepath);
      if (stats.size > 0) {
        return filepath;
      } else {
        console.warn(`[xlsx-export] Warning: File created but is empty: ${filepath}`);
      }
    }
  } catch (err) {
    console.error(`[xlsx-export] Error saving file ${filepath}:`, err);
    throw err;
  }

  return filepath;
}

/**
 * Generate filename for export
 */
export function generateExportFilename(deviceId: string, deviceName: string, type: 'hourly' | 'session' | 'daily'): string {
  const date = new Date().toISOString().split('T')[0];
  const sanitizedName = deviceName.replace(/[^a-zA-Z0-9]/g, '_');
  return `player_${sanitizedName}_${deviceId.substring(0, 8)}_${type}_${date}.xlsx`;
}
