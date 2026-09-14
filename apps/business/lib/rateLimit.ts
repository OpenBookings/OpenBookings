/**
 * Simple in-memory rate limiter
 * For production, consider using Redis or a dedicated rate limiting service
 */

interface RateLimitEntry {
  count: number
  resetTime: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}, 5 * 60 * 1000)

/**
 * Rate limit check
 * @param identifier - Unique identifier (email, IP, etc.)
 * @param maxRequests - Maximum requests allowed
 * @param windowMs - Time window in milliseconds
 * @returns Object with allowed status and remaining requests
 */
export function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now()
  const entry = rateLimitStore.get(identifier)

  if (!entry || now > entry.resetTime) {
    // Create new entry or reset expired entry
    const resetTime = now + windowMs
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime,
    })
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime,
    }
  }

  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    }
  }

  // Increment count
  entry.count++
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetTime: entry.resetTime,
  }
}

/**
 * Client IP for rate-limit bucketing.
 *
 * Order matters, and matches IP_ADDRESS_HEADERS in packages/auth/src/server.ts
 * for the same reason: `cf-connecting-ip` is a single address written by
 * Cloudflare and overwritten on every request, whereas the leftmost token of
 * `x-forwarded-for` is whatever the client sent. Reading XFF first let any
 * caller pick its own bucket — and therefore mint unlimited magic links for an
 * address — by rotating one header.
 *
 * This is only sound while the origin cannot be reached except through
 * Cloudflare. If the container URL is publicly reachable, a client can set
 * `cf-connecting-ip` itself and the IP limit is decorative; the per-email
 * limit above it is the one that still bites.
 */
export function getClientIP(request: Request): string {
  const cloudflare = request.headers.get("cf-connecting-ip")?.trim()
  if (cloudflare) {
    return cloudflare
  }

  const realIP = request.headers.get("x-real-ip")?.trim()
  if (realIP) {
    return realIP
  }

  // Spoofable, so last: better a shared bucket than an attacker-chosen one.
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    return forwarded.split(",")[0].trim()
  }

  // Fallback (won't work in serverless, but useful for local dev)
  return "unknown"
}
