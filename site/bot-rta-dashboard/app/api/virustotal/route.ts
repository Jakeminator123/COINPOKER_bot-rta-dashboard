/**
 * VirusTotal API Endpoint
 * =======================
 * Provides hash lookup functionality for the dashboard.
 * Results are cached in Redis and shared with the scanner.
 * 
 * Endpoints:
 * - GET /api/virustotal?hash=<sha256> - Check a single hash
 * - GET /api/virustotal/stats - Get VT statistics
 * - POST /api/virustotal - Check multiple hashes (batch)
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkHash, checkHashesBatch, getVTStats, getAllCachedResults } from '@/lib/virustotal/virustotal-service';

// Validate SHA256 hash format
function isValidSha256(hash: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(hash);
}

/**
 * GET /api/virustotal?hash=<sha256>
 * GET /api/virustotal?action=stats
 * GET /api/virustotal?action=cache
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const hash = searchParams.get('hash');
  const action = searchParams.get('action');
  
  // Get statistics
  if (action === 'stats') {
    try {
      const stats = await getVTStats();
      return NextResponse.json({
        success: true,
        stats,
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Failed to get stats' },
        { status: 500 }
      );
    }
  }
  
  // Get all cached results
  if (action === 'cache') {
    try {
      const results = await getAllCachedResults();
      return NextResponse.json({
        success: true,
        count: results.length,
        results,
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Failed to get cache' },
        { status: 500 }
      );
    }
  }
  
  // Check single hash
  if (!hash) {
    return NextResponse.json(
      { success: false, error: 'Missing hash parameter' },
      { status: 400 }
    );
  }
  
  if (!isValidSha256(hash)) {
    return NextResponse.json(
      { success: false, error: 'Invalid SHA256 hash format' },
      { status: 400 }
    );
  }
  
  try {
    const result = await checkHash(hash);
    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('[VT API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check hash' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/virustotal
 * Body: { hashes: string[], processName?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { hashes, hash, processName } = body;
    
    // Single hash check
    if (hash && typeof hash === 'string') {
      if (!isValidSha256(hash)) {
        return NextResponse.json(
          { success: false, error: 'Invalid SHA256 hash format' },
          { status: 400 }
        );
      }
      
      const result = await checkHash(hash, undefined, processName);
      return NextResponse.json({
        success: true,
        result,
      });
    }
    
    // Batch hash check
    if (hashes && Array.isArray(hashes)) {
      // Validate all hashes
      const invalidHashes = hashes.filter(h => !isValidSha256(h));
      if (invalidHashes.length > 0) {
        return NextResponse.json(
          { 
            success: false, 
            error: `Invalid hash format: ${invalidHashes[0]}`,
            invalidCount: invalidHashes.length 
          },
          { status: 400 }
        );
      }
      
      // Limit batch size
      if (hashes.length > 100) {
        return NextResponse.json(
          { success: false, error: 'Maximum 100 hashes per batch' },
          { status: 400 }
        );
      }
      
      const results = await checkHashesBatch(hashes);
      return NextResponse.json({
        success: true,
        count: results.size,
        results: Object.fromEntries(results),
      });
    }
    
    return NextResponse.json(
      { success: false, error: 'Missing hash or hashes parameter' },
      { status: 400 }
    );
    
  } catch (error) {
    console.error('[VT API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

