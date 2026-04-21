/**
 * Rate limit middleware for federation endpoints.
 *
 * Simple in-memory sliding-window counter, per source IP. Not distributed;
 * fine for the single-instance deployment model. If Parchment ever runs
 * horizontally, replace with a Redis-backed limiter.
 */

import { Elysia } from 'elysia'
import { logger } from '../lib/logger'

interface Bucket {
  count: number
  resetAt: number
}

const WINDOW_MS = 60_000

const wellKnownBuckets = new Map<string, Bucket>()
const inboxBuckets = new Map<string, Bucket>()

const WELL_KNOWN_PER_MIN = 60
const INBOX_PER_MIN = 120

function allow(
  buckets: Map<string, Bucket>,
  key: string,
  limit: number,
): boolean {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  existing.count += 1
  return existing.count <= limit
}

function sourceIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

export const federationRateLimit = new Elysia({ name: 'federation-rate-limit' })
  .onBeforeHandle(({ request, set }) => {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/federation/inbox') {
      const ip = sourceIp(request)
      if (!allow(inboxBuckets, ip, INBOX_PER_MIN)) {
        logger.warn({ ip, path }, 'Federation inbox rate limit exceeded')
        set.status = 429
        set.headers['Retry-After'] = '60'
        return { message: 'Rate limit exceeded' }
      }
      return
    }

    if (path.startsWith('/.well-known/user/') || path === '/.well-known/parchment-server') {
      const ip = sourceIp(request)
      if (!allow(wellKnownBuckets, ip, WELL_KNOWN_PER_MIN)) {
        logger.warn({ ip, path }, 'Federation well-known rate limit exceeded')
        set.status = 429
        set.headers['Retry-After'] = '60'
        return { message: 'Rate limit exceeded' }
      }
    }
  })
  .as('scoped')
