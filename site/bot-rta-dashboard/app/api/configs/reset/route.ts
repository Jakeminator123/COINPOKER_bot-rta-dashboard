import { NextRequest } from 'next/server';
import * as fs from 'fs/promises';
import path from 'path';
import { successResponse, errorResponse, validateToken, parseJsonBody, type ConfigResetRequest } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin token (should be in environment variable in production)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-secret-2024';

export async function POST(request: NextRequest) {
  try {
    // Check authorization
    const tokenValidation = validateToken(request, ADMIN_TOKEN);
    if (!tokenValidation.valid) {
      return errorResponse(tokenValidation.error || 'Unauthorized', 401);
    }

    // Parse request body safely
    const parsed = await parseJsonBody<ConfigResetRequest>(request);
    if (!parsed.success) {
      return errorResponse(parsed.error, 400);
    }

    const { category, test = false } = parsed.data;

    // If this is just a test, return success
    if (test) {
      return successResponse({ test: true });
    }

    // Paths
    const configDir = path.join(process.cwd(), 'configs');
    const defaultValuesDir = path.join(configDir, 'default_values');

    // If specific category requested
    if (category) {
      const defaultFile = path.join(defaultValuesDir, `${category}.json`);
      const configFile = path.join(configDir, `${category}.json`);

      try {
        // Read default values
        const defaultContent = await fs.readFile(defaultFile, 'utf-8');
        const defaultConfig = JSON.parse(defaultContent);

        // Write to main config file
        await fs.writeFile(configFile, JSON.stringify(defaultConfig, null, 2), 'utf-8');

        console.log(`[ConfigReset] Reset ${category} to default values`);

        return successResponse({
          message: `Configuration ${category} reset to default successfully`,
          category,
        });
      } catch (err) {
        console.error(`Failed to reset ${category}:`, err);
        return errorResponse(
          err instanceof Error ? err : `Failed to reset ${category}`,
          500
        );
      }
    }

    // Reset all configurations
    const configFiles = [
      'programs_registry.json',  // Unified registry (master source for all programs)
      'programs_config.json',    // Process scanner settings only
      'network_config.json',
      'behaviour_config.json',
      'screen_config.json',
      'vm_config.json',
      'obfuscation_config.json',
      'shared_config.json'
      // automation_programs.json removed - deprecated, use programs_registry.json instead
    ];

    const results = [];

    for (const filename of configFiles) {
      const cat = filename.replace('.json', '');
      const defaultFile = path.join(defaultValuesDir, filename);
      const configFile = path.join(configDir, filename);

      try {
        // Read default values
        const defaultContent = await fs.readFile(defaultFile, 'utf-8');
        const defaultConfig = JSON.parse(defaultContent);

        // Write to main config file
        await fs.writeFile(configFile, JSON.stringify(defaultConfig, null, 2), 'utf-8');

        results.push({ category: cat, success: true });
        console.log(`[ConfigReset] Reset ${cat} to default values`);
      } catch (err) {
        console.error(`Failed to reset ${cat}:`, err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ category: cat, success: false, error: errorMsg });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return successResponse({
      message: `Reset ${successCount}/${totalCount} configurations to default`,
      results,
    });

  } catch (error) {
    console.error('Config reset error:', error);
    return errorResponse(
      error instanceof Error ? error : 'Failed to reset configurations',
      500
    );
  }
}
