/**
 * Validation utilities for API endpoints
 */

/**
 * Validates if a string is a valid MD5 hash (device_id format)
 * MD5 hashes are always 32 hexadecimal characters
 */
export function isValidDeviceId(id: string | undefined | null): boolean {
  if (!id || typeof id !== 'string') return false;
  return /^[a-f0-9]{32}$/i.test(id);
}

/**
 * Validates if a string is a valid device name
 * Should be alphanumeric with spaces, hyphens, underscores
 * Max 50 characters
 */
export function isValidDeviceName(name: string | undefined | null): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 50) return false;
  return /^[a-zA-Z0-9\s\-_]+$/.test(name);
}

/**
 * Validates IP address format (IPv4)
 */
export function isValidIPAddress(ip: string | undefined | null): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  
  return parts.every(part => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255;
  });
}

/**
 * Validates signal status values
 */
export function isValidStatus(status: string | undefined | null): boolean {
  if (!status || typeof status !== 'string') return false;
  const validStatuses = ['CRITICAL', 'ALERT', 'WARN', 'INFO'];
  return validStatuses.includes(status.toUpperCase());
}

/**
 * Validates signal category
 */
export function isValidCategory(category: string | undefined | null): boolean {
  if (!category || typeof category !== 'string') return false;
  if (category.length > 50) return false;
  // Categories are lowercase with optional forward slashes
  return /^[a-z][a-z0-9/_-]*$/.test(category);
}

/**
 * Sanitizes user input to prevent XSS
 * Removes HTML tags and dangerous characters
 */
export function sanitizeInput(input: string | undefined | null): string {
  if (!input || typeof input !== 'string') return '';
  
  // Remove HTML tags
  let sanitized = input.replace(/<[^>]*>/g, '');
  
  // Remove dangerous characters
  sanitized = sanitized.replace(/[<>\"\']/g, '');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Limit length
  if (sanitized.length > 1000) {
    sanitized = sanitized.substring(0, 1000);
  }
  
  return sanitized;
}

/**
 * Validates the entire signal payload
 */
export function validateSignalPayload(payload: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Check if payload exists and is an object or array
  if (!payload) {
    errors.push('Payload is required');
    return { valid: false, errors };
  }
  
  // Handle both single signal and array of signals
  const signals = Array.isArray(payload) ? payload : [payload];
  
  if (signals.length === 0) {
    errors.push('At least one signal is required');
    return { valid: false, errors };
  }
  
  if (signals.length > 100) {
    errors.push('Too many signals in one request (max 100)');
    return { valid: false, errors };
  }
  
  // Validate each signal
  signals.forEach((signal, index) => {
    if (!signal || typeof signal !== 'object') {
      errors.push(`Signal ${index + 1}: Invalid signal object`);
      return;
    }
    
    // Validate required fields
    if (!signal.device_id) {
      errors.push(`Signal ${index + 1}: device_id is required`);
    } else if (!isValidDeviceId(signal.device_id)) {
      errors.push(`Signal ${index + 1}: Invalid device_id format (must be 32 hex characters)`);
    }
    
    if (!signal.category) {
      errors.push(`Signal ${index + 1}: category is required`);
    } else if (!isValidCategory(signal.category)) {
      errors.push(`Signal ${index + 1}: Invalid category format`);
    }
    
    if (!signal.name) {
      errors.push(`Signal ${index + 1}: name is required`);
    }
    
    // Validate optional fields if present
    if (signal.device_name && !isValidDeviceName(signal.device_name)) {
      errors.push(`Signal ${index + 1}: Invalid device_name format`);
    }
    
    if (signal.device_ip && !isValidIPAddress(signal.device_ip)) {
      errors.push(`Signal ${index + 1}: Invalid IP address format`);
    }
    
    if (signal.status && !isValidStatus(signal.status)) {
      errors.push(`Signal ${index + 1}: Invalid status value`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors
  };
}
