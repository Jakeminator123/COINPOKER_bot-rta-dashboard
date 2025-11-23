/**
 * Simple in-memory rate limiter for API endpoints
 * Uses token bucket algorithm
 */

interface RateLimitStore {
  [key: string]: {
    tokens: number;
    lastRefill: number;
  };
}

export class RateLimiter {
  private store: RateLimitStore = {};
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second
  private readonly windowMs: number;
  
  constructor(options: {
    maxRequests?: number;
    windowMs?: number;
  } = {}) {
    this.maxTokens = options.maxRequests || 100;
    this.windowMs = options.windowMs || 60000; // 1 minute default
    this.refillRate = this.maxTokens / (this.windowMs / 1000);
  }
  
  /**
   * Check if request should be allowed
   * @param identifier - IP address or device_id
   * @returns true if allowed, false if rate limited
   */
  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const bucket = this.store[identifier] || {
      tokens: this.maxTokens,
      lastRefill: now
    };
    
    // Refill tokens based on time passed
    const timePassed = (now - bucket.lastRefill) / 1000; // in seconds
    const tokensToAdd = Math.min(
      timePassed * this.refillRate,
      this.maxTokens - bucket.tokens
    );
    
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
    
    // Check if we have tokens available
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.store[identifier] = bucket;
      return true;
    }
    
    this.store[identifier] = bucket;
    return false;
  }
  
  /**
   * Get remaining tokens for an identifier
   */
  getRemainingTokens(identifier: string): number {
    const bucket = this.store[identifier];
    if (!bucket) return this.maxTokens;
    
    const now = Date.now();
    const timePassed = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = Math.min(
      timePassed * this.refillRate,
      this.maxTokens - bucket.tokens
    );
    
    return Math.floor(Math.min(this.maxTokens, bucket.tokens + tokensToAdd));
  }
  
  /**
   * Reset rate limit for an identifier
   */
  reset(identifier: string): void {
    delete this.store[identifier];
  }
  
  /**
   * Clean up old entries to prevent memory leak
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = this.windowMs * 2; // Keep entries for 2 windows
    
    for (const [key, bucket] of Object.entries(this.store)) {
      if (now - bucket.lastRefill > maxAge) {
        delete this.store[key];
      }
    }
  }
}

// Global rate limiters
const signalLimiter = new RateLimiter({
  maxRequests: 100,
  windowMs: 60000 // 100 requests per minute
});

const generalLimiter = new RateLimiter({
  maxRequests: 300,
  windowMs: 60000 // 300 requests per minute for other endpoints
});

// Cleanup old entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    signalLimiter.cleanup();
    generalLimiter.cleanup();
  }, 5 * 60 * 1000);
}

export { signalLimiter, generalLimiter };

/**
 * Express-style rate limit middleware for Next.js API routes
 */
type RouteHandler = (req: Request) => Response | Promise<Response>;

export function withRateLimit(
  handler: RouteHandler,
  options: { limiter?: RateLimiter; identifierFn?: (req: Request) => string } = {}
) {
  const limiter = options.limiter || generalLimiter;
  const getIdentifier = options.identifierFn || ((req: Request) => {
    // Try to get IP from various headers
    const forwarded = req.headers.get('x-forwarded-for');
    const real = req.headers.get('x-real-ip');
    const ip = forwarded?.split(',')[0] || real || 'unknown';
    return ip;
  });
  
  return async function rateLimitedHandler(req: Request) {
    const identifier = getIdentifier(req);
    
    if (!limiter.isAllowed(identifier)) {
      return Response.json(
        {
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: 60
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(Date.now() + 60000).toISOString(),
            'Retry-After': '60'
          }
        }
      );
    }
    
    // Add rate limit headers to response
    const remaining = limiter.getRemainingTokens(identifier);
    const response = await handler(req);
    
    // Clone response to add headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-RateLimit-Limit', '100');
    newHeaders.set('X-RateLimit-Remaining', remaining.toString());
    newHeaders.set('X-RateLimit-Reset', new Date(Date.now() + 60000).toISOString());
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  };
}
