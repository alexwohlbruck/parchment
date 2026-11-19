/**
 * In-memory fixed-window rate limits. Not distributed — fine for the
 * single-instance deployment model; a horizontal deployment needs a shared
 * store instead.
 *
 * Every limiter owns its own buckets, so routes carry independent budgets.
 * Keys are a user id, a client IP, or anything a route derives from its body
 * (the email on sign-in). A 429 carries `Retry-After` in seconds.
 */

import { Elysia } from 'elysia'
import { logger } from '../lib/logger'
import { translatorFor } from '../lib/i18n/translate'

interface Bucket {
  count: number
  resetAt: number
}

export interface RateLimitOptions {
  name: string
  limit: number
  windowMs?: number
}

type KeyContext = {
  request: Request
  server?: { requestIP(request: Request): { address: string } | null } | null
  user?: { id?: string } | null
  body?: unknown
}

type KeyFn = (ctx: KeyContext) => string | undefined

export class RateLimiter {
  private buckets = new Map<string, Bucket>()
  private nextSweep = 0

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Seconds until the key may retry, or 0 when the hit is allowed. */
  hit(key: string, now = Date.now()): number {
    this.sweep(now)
    const bucket = this.buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs })
      return 0
    }
    bucket.count += 1
    if (bucket.count <= this.limit) return 0
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  }

  get size() {
    return this.buckets.size
  }

  private sweep(now: number) {
    if (now < this.nextSweep) return
    this.nextSweep = now + this.windowMs
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key)
    }
  }
}

function trustedProxyHops() {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)
  return Number.isInteger(hops) && hops >= 0 ? hops : 1
}

/**
 * The client address as seen by the outermost trusted proxy. Entries left of
 * that are client-supplied and would let a caller mint a fresh bucket per request.
 */
export function clientIp(
  request: Request,
  socketIp?: string,
  hops = trustedProxyHops(),
): string {
  const forwarded = request.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (hops > 0 && forwarded?.length) {
    return forwarded[Math.max(0, forwarded.length - hops)]!
  }
  return socketIp ?? 'unknown'
}

const ipOf = ({ request, server }: KeyContext) =>
  clientIp(request, server?.requestIP(request)?.address)

type LimitContext = KeyContext & {
  set: { status?: number | string; headers: Record<string, string | number> }
}

function enforce(ctx: LimitContext, limiter: RateLimiter, name: string, id: string | undefined) {
  if (!id) return
  const retryAfter = limiter.hit(id)
  if (!retryAfter) return
  logger.warn({ name, path: new URL(ctx.request.url).pathname }, 'Rate limit exceeded')
  ctx.set.status = 429
  ctx.set.headers['Retry-After'] = String(retryAfter)
  return { message: translatorFor(ctx.request)('errors.rateLimit.exceeded') }
}

/** A `beforeHandle` that 429s once `key` exceeds the budget; no key, no limit. */
export function rateLimitHandler(
  { name, limit, windowMs = 60_000 }: RateLimitOptions,
  key: KeyFn,
) {
  const limiter = new RateLimiter(limit, windowMs)
  return (ctx: unknown) => {
    const limitCtx = ctx as LimitContext
    return enforce(limitCtx, limiter, name, key(limitCtx))
  }
}

export const byUser: KeyFn = ({ user }) => user?.id

export const byIp: KeyFn = ipOf

export const byClient: KeyFn = (ctx) =>
  ctx.user?.id ? `user:${ctx.user.id}` : `ip:${ipOf(ctx)}`

export const byEmail: KeyFn = ({ body }) => {
  const email = (body as { email?: unknown } | undefined)?.email
  return typeof email === 'string' ? email.trim().toLowerCase() : undefined
}

const plugin = (key: KeyFn) => (options: RateLimitOptions) => {
  const handler = rateLimitHandler(options, key)
  return (app: Elysia) => app.onBeforeHandle(handler)
}

/** Per signed-in user. Apply after `requireAuth`; anonymous requests pass. */
export const makeUserRateLimit = plugin(byUser)

/** Per client IP, for unauthenticated endpoints. */
export const makeIpRateLimit = plugin(byIp)

/** Per user when signed in, per IP otherwise. Apply after `optionalAuth`. */
export const makeClientRateLimit = plugin(byClient)

const wellKnownLimiter = new RateLimiter(60, 60_000)
const inboxLimiter = new RateLimiter(120, 60_000)

export const federationRateLimit = new Elysia({ name: 'federation-rate-limit' })
  .onBeforeHandle((ctx) => {
    const limitCtx = ctx as unknown as LimitContext
    const path = new URL(ctx.request.url).pathname
    if (path === '/federation/inbox') {
      return enforce(limitCtx, inboxLimiter, 'federation-inbox', ipOf(limitCtx))
    }
    if (path.startsWith('/.well-known/user/') || path === '/.well-known/parchment-server') {
      return enforce(limitCtx, wellKnownLimiter, 'federation-well-known', ipOf(limitCtx))
    }
  })
  .as('scoped')
