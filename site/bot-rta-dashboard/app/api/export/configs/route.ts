import { NextRequest } from "next/server";
import * as fs from "fs/promises";
import path from "path";
import { successResponse, errorResponse } from "@/lib/utils/api-utils";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    const configDir = path.join(process.cwd(), "configs");
    const allConfigs: Record<string, unknown> = {};
    
    // List of config files to export (in priority order)
    const configFiles = [
      "programs_registry.json",    // Master program definitions
      "programs_config.json",       // Process scanner settings ONLY
      "network_config.json",        // Network detection settings
      "behaviour_config.json",      // Behavior detection settings
      "screen_config.json",         // Screen detection settings
      "vm_config.json",            // VM detection settings
      "obfuscation_config.json",   // Obfuscation detection settings
      "shared_config.json",        // Shared definitions
    ];
    
    // Load all config files
    for (const filename of configFiles) {
      const filePath = path.join(configDir, filename);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const configName = filename.replace(".json", "");
        allConfigs[configName] = JSON.parse(content) as unknown;
      } catch (err) {
        console.warn(`Skipping ${filename}:`, err);
      }
    }
    
    // Add metadata
    allConfigs._meta = {
      version: "2.0.0",
      exported: new Date().toISOString(),
      description: "CoinPoker Bot Detection System - Consolidated Configuration Package"
    };
    
    // Create response with appropriate headers for download
    const jsonString = JSON.stringify(allConfigs, null, 2);
    const response = new Response(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="detector_configs_${Date.now()}.json"`,
        'Cache-Control': 'no-cache'
      }
    });
    
    return response;
  } catch (error) {
    console.error("Export error:", error);
    return errorResponse("Failed to export configurations", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    // Import configurations (requires admin token)
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    const adminToken = process.env.ADMIN_TOKEN || "admin";
    
    if (token !== adminToken) {
      return errorResponse("Unauthorized", 401);
    }
    
    const body = await request.json();
    
    if (!body || !body._meta) {
      return errorResponse("Invalid configuration package", 400);
    }
    
    const configDir = path.join(process.cwd(), "configs");
    
    // Backup existing configs
    const backupDir = path.join(configDir, "backups");
    await fs.mkdir(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0];
    
    // Save each config file
    const savedFiles: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (key === "_meta") continue;
      
      const filename = `${key}.json`;
      const filePath = path.join(configDir, filename);
      
      // Backup existing file if it exists
      try {
        const existing = await fs.readFile(filePath, "utf-8");
        const backupPath = path.join(backupDir, `${key}_${timestamp}.json`);
        await fs.writeFile(backupPath, existing, "utf-8");
      } catch (err) {
        // File doesn't exist, no backup needed
      }
      
      // Write new config
      await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
      savedFiles.push(filename);
    }
    
    return successResponse({
      message: "Configurations imported successfully",
      files: savedFiles,
      backup: timestamp
    });
    
  } catch (error) {
    console.error("Import error:", error);
    return errorResponse("Failed to import configurations", 500);
  }
}
