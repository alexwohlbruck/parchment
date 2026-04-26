/**
 * Rate-limit middleware.
 *
 * Simple in-memory sliding-window counter. Not distributed — fine for the
 * single-instance deployment model. If Parchment ever runs horizontally,
 * replace with a Redis-backed limiter.
 *
 * Two flavors:
 *   1. `federationRateLimit` — path-scoped by-IP limits for the
 *      `.well-known/*` and `/federation/inbox` endpoints.
 *   2. `makeUserRateLimit({ limit, windowMs })` — per-authenticated-user
 *      limiter for any route group. Must be chained AFTER `requireAuth`
 *      so the `user` context field is present.
 */

import { Elysia } from 'elysia'
import { logger } from '../lib/logger'

interface Bucket {
  count: number
  resetAt: number
}

const FEDERATION_WINDOW_MS = 60_000

const wellKnownBuckets = new Map<string, Bucket>()
const inboxBuckets = new Map<string, Bucket>()

const WELL_KNOWN_PER_MIN = 60
const INBOX_PER_MIN = 120

function allow(
  buckets: Map<string, Bucket>,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
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
      if (!allow(inboxBuckets, ip, INBOX_PER_MIN, FEDERATION_WINDOW_MS)) {
        logger.warn({ ip, path }, 'Federation inbox rate limit exceeded')
        set.status = 429
        set.headers['Retry-After'] = '60'
        return { message: 'Rate limit exceeded' }
      }
      return
    }

    if (path.startsWith('/.well-known/user/') || path === '/.well-known/parchment-server') {
      const ip = sourceIp(request)
      if (!allow(wellKnownBuckets, ip, WELL_KNOWN_PER_MIN, FEDERATION_WINDOW_MS)) {
        logger.warn({ ip, path }, 'Federation well-known rate limit exceeded')
        set.status = 429
        set.headers['Retry-After'] = '60'
        return { message: 'Rate limit exceeded' }
      }
    }
  })
  .as('scoped')

/**
 * Build a per-authenticated-user rate-limit plugin. Each invocation owns
 * its own bucket map so different routes can have independent budgets.
 *
 * Apply AFTER `requireAuth` so `user.id` is in context. Unauthenticated
 * requests (no `user` in context) are passed through — the route's own
 * auth guard is the real gate; this middleware only polices request
 * frequency.
 */
export function makeUserRateLimit({
  name,
  limit,
  windowMs = 60_000,
}: {
  name: string
  limit: number
  windowMs?: number
}) {
  const buckets = new Map<string, Bucket>()
  return (app: Elysia) =>
    app.onBeforeHandle((ctx) => {
      const request = ctx.request
      const set = ctx.set
      const user = (ctx as unknown as { user?: { id?: string } }).user
      const userId = user?.id
      if (!userId) return
      if (!allow(buckets, userId, limit, windowMs)) {
        const path = new URL(request.url).pathname
        logger.warn({ userId, path, name }, 'User rate limit exceeded')
        set.status = 429
        set.headers['Retry-After'] = String(Math.ceil(windowMs / 1000))
        return { message: 'Rate limit exceeded' }
      }
    })
}

/**
 * Per-IP rate-limit plugin for unauthenticated endpoints (public share
 * resolvers, anonymous browsing, etc.). Each invocation gets its own
 * bucket map so different endpoints can carry independent budgets.
 *
 * IP is resolved from the standard proxy headers (X-Forwarded-For,
 * X-Real-IP) with a fallback to a sentinel string. Abusers sharing a
 * proxy will share a bucket — acceptable since the shared-pool case
 * tends to be corporate NAT, not a deliberate workaround.
 */
export function makeIpRateLimit({
  name,
  limit,
  windowMs = 60_000,
}: {
  name: string
  limit: number
  windowMs?: number
}) {
  const buckets = new Map<string, Bucket>()
  return (app: Elysia) =>
    app.onBeforeHandle((ctx) => {
      const ip = sourceIp(ctx.request)
      if (!allow(buckets, ip, limit, windowMs)) {
        const path = new URL(ctx.request.url).pathname
        logger.warn({ ip, path, name }, 'IP rate limit exceeded')
        ctx.set.status = 429
        ctx.set.headers['Retry-After'] = String(Math.ceil(windowMs / 1000))
        return { message: 'Rate limit exceeded' }
      }
    })
}
