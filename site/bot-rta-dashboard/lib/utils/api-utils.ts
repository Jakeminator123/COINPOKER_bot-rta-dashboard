/**
 * API Response Utilities
 * ======================
 * Common utilities for consistent API responses across all endpoints
 */

import { NextResponse } from 'next/server';

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: number;
}

/**
 * Standard success response
 */
export function successResponse<T>(
  data: T,
  status: number = 200,
  options?: {
    headers?: Record<string, string>;
    cache?: 'no-cache' | 'no-store' | 'public';
  }
): NextResponse<ApiResponse<T>> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...(options?.cache && {
      'Cache-Control': options.cache === 'no-store'
        ? 'no-store, no-cache, must-revalidate'
        : options.cache === 'no-cache'
        ? 'no-cache, must-revalidate'
        : 'public, max-age=60'
    }),
    ...options?.headers,
  };

  return NextResponse.json(
    {
      ok: true,
      data,
      timestamp: Date.now(),
    } as ApiResponse<T>,
    { status, headers }
  );
}

/**
 * Standard error response
 */
export function errorResponse(
  error: string | Error,
  status: number = 500,
  details?: Record<string, unknown>
): NextResponse<ApiResponse> {
  const errorMessage = error instanceof Error ? error.message : error;

  return NextResponse.json(
    {
      ok: false,
      error: errorMessage,
      ...details,
      timestamp: Date.now(),
    } as ApiResponse,
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    }
  );
}

/**
 * CORS preflight handler
 */
export function corsOptions(): NextResponse {
  return NextResponse.json({}, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Validate bearer token
 */
export function validateToken(
  request: Request,
  requiredToken?: string
): { valid: boolean; error?: string } {
  if (!requiredToken) {
    return { valid: true }; // No token required
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing Authorization header' };
  }

  const token = authHeader.replace('Bearer ', '');
  if (token !== requiredToken) {
    return { valid: false, error: 'Invalid token' };
  }

  return { valid: true };
}

/**
 * Parse JSON body safely
 */
export async function parseJsonBody<T = unknown>(
  request: Request
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const text = await request.text();
    if (!text || text.trim() === '') {
      return { success: false, error: 'Empty request body' };
    }

    const data = JSON.parse(text) as T;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

/**
 * Type definitions for common API request bodies
 */
export interface ConfigResetRequest {
  category?: string;
  test?: boolean;
}

export interface ConfigPostRequest {
  category: string;
  config: unknown;
  adminToken?: string;
}

export interface ConfigUpdateRequest {
  category: string;
  updates?: unknown;
  config?: unknown;
  merge?: boolean;
  test?: boolean;
  adminToken?: string;
}

export interface SettingsPostRequest {
  category: string;
  config: unknown;
}

/**
 * Get client IP address
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  return 'unknown';
}

/**
 * Validate NextAuth session for API routes
 * Returns the session if valid, null otherwise
 */
export async function getServerSession() {
  // Dynamic import to avoid issues with server components
  const { getServerSession: getSession } = await import('next-auth');
  const { authConfig } = await import('@/lib/utils/auth');
  return getSession(authConfig);
}

/**
 * Require authentication for API route
 * Returns error response if not authenticated
 */
export async function requireAuth(): Promise<{ authenticated: true; user: string } | { authenticated: false; response: NextResponse }> {
  const session = await getServerSession();
  
  if (!session?.user?.name) {
    return {
      authenticated: false,
      response: errorResponse('Authentication required. Please log in.', 401),
    };
  }
  
  return {
    authenticated: true,
    user: session.user.name,
  };
}

