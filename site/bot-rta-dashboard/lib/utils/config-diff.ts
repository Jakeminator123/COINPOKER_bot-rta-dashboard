/**
 * Configuration comparison utilities
 * Compares current configurations with default values to identify changes
 */

export interface ConfigDiff {
  hasChanges: boolean;
  addedItems: string[];
  removedItems: string[];
  modifiedItems: string[];
  summary: {
    totalAdded: number;
    totalRemoved: number;
    totalModified: number;
  };
}

type ConfigObject = Record<string, unknown>;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string");


const isObject = (value: unknown): value is ConfigObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function compareConfigs(current: unknown, defaults: unknown): ConfigDiff {
  const addedItems: string[] = [];
  const removedItems: string[] = [];
  const modifiedItems: string[] = [];

  // Handle different config types
  if (current && defaults) {
    // For automation_programs, programs_config, etc. (object-based configs)
    if (isObject(current) && isObject(defaults)) {
      const currentKeys = Object.keys(current);
      const defaultKeys = Object.keys(defaults);

      // Find added items (in current but not in defaults)
      currentKeys.forEach(key => {
        if (!defaultKeys.includes(key)) {
          addedItems.push(key);
        }
      });

      // Find removed items (in defaults but not in current)
      defaultKeys.forEach(key => {
        if (!currentKeys.includes(key)) {
          removedItems.push(key);
        }
      });

      // Find modified items (in both but different values)
      defaultKeys.forEach(key => {
        if (currentKeys.includes(key)) {
          const currentItem = current[key];
          const defaultItem = defaults[key];
          if (JSON.stringify(currentItem) !== JSON.stringify(defaultItem)) {
            modifiedItems.push(key);
          }
        }
      });
    }

    // For array-based configs (like suspicious_tools)
    else if (isStringArray(current) && isStringArray(defaults)) {
      const currentSet = new Set(current);
      const defaultSet = new Set(defaults);

      // Find added items
      current.forEach(item => {
        if (!defaultSet.has(item)) {
          addedItems.push(item);
        }
      });

      // Find removed items
      defaults.forEach(item => {
        if (!currentSet.has(item)) {
          removedItems.push(item);
        }
      });
    }
  }

  return {
    hasChanges: addedItems.length > 0 || removedItems.length > 0 || modifiedItems.length > 0,
    addedItems,
    removedItems,
    modifiedItems,
    summary: {
      totalAdded: addedItems.length,
      totalRemoved: removedItems.length,
      totalModified: modifiedItems.length
    }
  };
}

export function findMissingItems(current: unknown, defaults: unknown): string[] {
  const diff = compareConfigs(current, defaults);
  return diff.removedItems;
}

export function getConfigCategoryKey(category: string): string {
  // Map category names to their main config keys
  const keyMap: Record<string, string> = {
    'automation_programs': 'automation_programs',
    'programs_config': 'programs_config',
    'network_config': 'network_config',
    'behaviour_config': 'behaviour_config',
    'screen_config': 'screen_config',
    'vm_config': 'vm_config',
    'obfuscation_config': 'obfuscation_config',
    'shared_config': 'shared_config'
  };

  return keyMap[category] || category;
}

export function extractMainConfig(config: unknown, category: string): unknown {
  const mainKey = getConfigCategoryKey(category);

  // If config has the main key, extract it
  if (isObject(config) && mainKey in config) {
    return config[mainKey];
  }

  // Otherwise return the config as-is
  return config;
}
