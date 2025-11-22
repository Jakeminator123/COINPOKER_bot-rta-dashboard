/**
 * Device Information Utilities
 * ============================
 * Parse and analyze device information from signals
 */
import type { Signal } from "@/lib/detections/sections";

export interface DeviceInfo {
  os: string;
  osVersion?: string;
  platform: 'Windows' | 'Mac' | 'Linux' | 'Android' | 'iOS' | 'Emulator' | 'Unknown';
  isEmulator: boolean;
  isVM: boolean;
  architecture?: string;
  browser?: string;
  screenResolution?: string;
  cpuCores?: number;
  ramGB?: number;
  gpuInfo?: string;
  networkType?: string;
  ipLocation?: {
    country?: string;
    city?: string;
    isp?: string;
  };
}

/**
 * Parse OS information from system signals
 */
export function parseDeviceInfo(signals: Signal[]): DeviceInfo {
  const info: DeviceInfo = {
    os: 'Unknown',
    platform: 'Unknown',
    isEmulator: false,
    isVM: false,
  };

  // Look for VM detection signals
  const vmSignals = signals.filter(s =>
    s.category === 'vm' ||
    s.name?.includes('Virtual') ||
    s.name?.includes('VMware') ||
    s.name?.includes('VirtualBox') ||
    s.name?.includes('Hyper-V') ||
    s.name?.includes('QEMU') ||
    s.name?.includes('KVM')
  );

  if (vmSignals.length > 0) {
    info.isVM = true;

    // Try to identify VM type
    const vmDetails = vmSignals[0]?.details || '';
    if (vmDetails.includes('VMware')) info.platform = 'Emulator';
    else if (vmDetails.includes('VirtualBox')) info.platform = 'Emulator';
    else if (vmDetails.includes('Android')) {
      info.platform = 'Android';
      info.isEmulator = true;
    }
  }

  // Look for OS information in system signals
  const systemSignals = signals.filter(s => s.category === 'system');
  for (const signal of systemSignals) {
    const details = signal.details || '';

    // Parse OS from VM detector output (e.g., "Windows 10.0.26200")
    const osMatch = details.match(/os:\s*([^,]+)/i);
    if (osMatch) {
      const osString = osMatch[1].trim();
      info.os = osString;

      // Determine platform
      if (osString.includes('Windows')) {
        info.platform = 'Windows';
        const versionMatch = osString.match(/Windows\s+([\d.]+)/);
        if (versionMatch) {
          info.osVersion = versionMatch[1];
          // Windows 11 is version 10.0.22000+
          if (parseFloat(versionMatch[1]) >= 10.0 && parseInt(versionMatch[1].split('.')[2] || '0') >= 22000) {
            info.os = 'Windows 11';
          }
        }
      } else if (osString.includes('Darwin') || osString.includes('Mac')) {
        info.platform = 'Mac';
      } else if (osString.includes('Linux')) {
        info.platform = 'Linux';
        // Check for Android
        if (osString.includes('Android')) {
          info.platform = 'Android';
        }
      }
    }

    // Parse screen resolution from screen monitoring
    const resMatch = details.match(/(\d+)x(\d+)/);
    if (resMatch) {
      info.screenResolution = `${resMatch[1]}x${resMatch[2]}`;
    }

    // Parse CPU cores
    const coresMatch = details.match(/cores?:\s*(\d+)/i);
    if (coresMatch) {
      info.cpuCores = parseInt(coresMatch[1]);
    }

    // Parse RAM
    const ramMatch = details.match(/ram:\s*([\d.]+)\s*GB/i);
    if (ramMatch) {
      info.ramGB = parseFloat(ramMatch[1]);
    }
  }

  // Check for emulator patterns
  const emulatorPatterns = [
    'BlueStacks',
    'NoxPlayer',
    'MEmu',
    'LDPlayer',
    'Genymotion',
    'Andy',
    'Droid4X',
    'AMIDuOS',
    'RemixOS',
    'Phoenix OS',
    'PrimeOS',
    'Android-x86',
    'Android Studio Emulator',
  ];

  for (const signal of signals) {
    const name = signal.name || '';
    const details = signal.details || '';
    const combined = `${name} ${details}`.toLowerCase();

    for (const pattern of emulatorPatterns) {
      if (combined.includes(pattern.toLowerCase())) {
        info.isEmulator = true;
        info.platform = 'Emulator';
        break;
      }
    }
  }

  return info;
}

/**
 * Get platform icon
 */
export function getPlatformIcon(platform: DeviceInfo['platform']): string {
  switch (platform) {
    case 'Windows':
      return '🪟';
    case 'Mac':
      return '🍎';
    case 'Linux':
      return '🐧';
    case 'Android':
      return '🤖';
    case 'iOS':
      return '📱';
    case 'Emulator':
      return '🖥️';
    default:
      return '💻';
  }
}

/**
 * Get platform color
 */
export function getPlatformColor(platform: DeviceInfo['platform']): string {
  switch (platform) {
    case 'Windows':
      return '#0078D4'; // Windows blue
    case 'Mac':
      return '#A2AAAD'; // macOS gray
    case 'Linux':
      return '#FCC624'; // Linux yellow
    case 'Android':
      return '#3DDC84'; // Android green
    case 'iOS':
      return '#000000'; // iOS black
    case 'Emulator':
      return '#FF6B6B'; // Red for emulators (suspicious)
    default:
      return '#94A3B8'; // Slate gray
  }
}

/**
 * Format device info for display
 */
export function formatDeviceInfo(info: DeviceInfo): string {
  const parts: string[] = [];

  if (info.os !== 'Unknown') {
    parts.push(info.os);
  }

  if (info.isEmulator) {
    parts.push('(Emulator)');
  } else if (info.isVM) {
    parts.push('(Virtual Machine)');
  }

  if (info.architecture) {
    parts.push(info.architecture);
  }

  if (info.screenResolution) {
    parts.push(info.screenResolution);
  }

  return parts.join(' • ');
}
