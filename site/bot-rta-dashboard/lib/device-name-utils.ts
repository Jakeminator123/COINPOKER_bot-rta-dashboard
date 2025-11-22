/**
 * Device Name Utilities
 * =====================
 * Helper functions to ensure consistent device name display across the application.
 * Prevents confusion between device IDs and nicknames.
 */

/**
 * Get a display-friendly name for a device.
 * Prioritizes actual device names over device IDs.
 * 
 * @param deviceName - The device name from Redis or API
 * @param deviceId - The device ID (fallback)
 * @returns A human-readable name for display
 */
export function getDeviceDisplayName(deviceName?: string | null, deviceId?: string | null): string {
  // If we have a real device name that's not just the device ID, use it
  if (deviceName && deviceName !== deviceId) {
    return deviceName;
  }
  
  // If device name is missing or is just the device ID, try to extract from ID
  if (deviceId) {
    // Some device IDs are in format "nickname_hash" - extract nickname
    if (deviceId.includes('_')) {
      const parts = deviceId.split('_');
      const nickname = parts[0];
      // Only use the nickname if it's not a hash (contains at least one letter)
      if (nickname && /[a-zA-Z]/.test(nickname)) {
        return nickname;
      }
    }
    
    // If device ID looks like a hash (32+ chars), show abbreviated version
    if (deviceId.length >= 32) {
      return `Device ${deviceId.substring(0, 8)}`;
    }
    
    // Otherwise use the full device ID
    return deviceId;
  }
  
  // Last resort
  return "Unknown Device";
}

/**
 * Check if a given string looks like a device ID (hash) rather than a name.
 * 
 * @param value - The string to check
 * @returns True if it looks like a device ID hash
 */
export function looksLikeDeviceId(value?: string | null): boolean {
  if (!value) return false;
  
  // Check if it's a long hex string (typical for device IDs)
  // Most device IDs are 32+ character hashes
  if (value.length >= 32 && /^[a-f0-9]+$/i.test(value)) {
    return true;
  }
  
  // Check if it's in the format "hash_hash" where both parts are hex
  const parts = value.split('_');
  if (parts.length === 2 && parts[0].length >= 16 && parts[1].length >= 16) {
    if (/^[a-f0-9]+$/i.test(parts[0]) && /^[a-f0-9]+$/i.test(parts[1])) {
      return true;
    }
  }
  
  return false;
}

/**
 * Sanitize a device name for storage.
 * Ensures we don't store device IDs as names.
 * 
 * @param deviceName - The proposed device name
 * @param deviceId - The device ID
 * @returns A sanitized device name or null if invalid
 */
export function sanitizeDeviceName(deviceName?: string | null, deviceId?: string | null): string | null {
  if (!deviceName) return null;
  
  // Don't store the device ID as the name
  if (deviceName === deviceId) return null;
  
  // Don't store if it looks like a hash
  if (looksLikeDeviceId(deviceName)) return null;
  
  // Trim and validate
  const trimmed = deviceName.trim();
  if (trimmed.length === 0) return null;
  
  return trimmed;
}
