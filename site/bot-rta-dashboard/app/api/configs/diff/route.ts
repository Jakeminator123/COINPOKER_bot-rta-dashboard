import { NextRequest } from 'next/server';
import * as fs from 'fs/promises';
import path from 'path';
import { compareConfigs, extractMainConfig } from '@/lib/config-diff';
import { successResponse, errorResponse } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    if (!category) {
      return errorResponse('Category parameter required', 400);
    }

    // Load current and default configs
    const configDir = path.join(process.cwd(), 'configs');
    const defaultValuesDir = path.join(configDir, 'default_values');

    const currentFile = path.join(configDir, `${category}.json`);
    const defaultFile = path.join(defaultValuesDir, `${category}.json`);

    // Check if files exist
    try {
      await fs.access(currentFile);
      await fs.access(defaultFile);
    } catch (error) {
      return errorResponse(`Config files not found for category: ${category}`, 404);
    }

    // Read and parse configs
    const currentRaw = await fs.readFile(currentFile, 'utf-8');
    const defaultRaw = await fs.readFile(defaultFile, 'utf-8');

    const currentConfig = JSON.parse(currentRaw);
    const defaultConfig = JSON.parse(defaultRaw);

    // Extract main config objects for comparison
    const currentMain = extractMainConfig(currentConfig, category);
    const defaultMain = extractMainConfig(defaultConfig, category);

    // Compare configs
    const diff = compareConfigs(currentMain, defaultMain);

    return successResponse({
      category,
      diff,
      configInfo: {
        currentKeys: currentMain ? Object.keys(currentMain).length : 0,
        defaultKeys: defaultMain ? Object.keys(defaultMain).length : 0
      }
    }, 200, { cache: 'no-store' });

  } catch (error) {
    console.error('Config diff error:', error);
    return errorResponse(
      error instanceof Error ? error : 'Failed to compare configs',
      500
    );
  }
}
