/**
 * Admission for Barrelman's transit endpoints.
 *
 * Barrelman caps simultaneous `/transit` requests per account and answers the
 * overflow with 429 and a Retry-After. A trip plan fans out wider than that
 * cap, so requests wait here in priority order, and a refused one is retried
 * after the hint instead of being lost.
 */

/** Lower runs first. */
export enum TransitPriority {
  /** The walk-access query every transit plan is built on. */
  Core = 0,
  /** Lookups that finish the itineraries already found. */
  Enrichment = 1,
  /** Alternative strategies (bike, park-and-ride, rental egress). */
  Variant = 2,
}

export interface TransitGateOptions {
  /** Requests in flight at once; 0 means unbounded. */
  concurrency: number
  /** Retries after a 429 before giving up. */
  maxRetries: number
  /** Ceiling on a single Retry-After wait. */
  maxRetryWaitMs: number
  sleep?: (ms: number) => Promise<void>
}

interface Waiter {
  priority: number
  seq: number
  resolve: () => void
}

export class TransitGate {
  private active = 0
  private seq = 0
  private readonly queue: Waiter[] = []
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: TransitGateOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  get inFlight(): number {
    return this.active
  }

  get waiting(): number {
    return this.queue.length
  }

  async run<T>(priority: TransitPriority, request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.acquire(priority)
      let waitMs: number | null
      try {
        return await request()
      } catch (error) {
        waitMs = rejectionRetryMs(error)
        if (waitMs == null || attempt >= this.options.maxRetries) throw error
      } finally {
        this.release()
      }
      await this.sleep(Math.min(waitMs, this.options.maxRetryWaitMs))
    }
  }

  private async acquire(priority: number): Promise<void> {
    const limit = this.options.concurrency
    if (limit <= 0 || this.active < limit) {
      this.active++
      return
    }
    await new Promise<void>((resolve) => {
      this.queue.push({ priority, seq: this.seq++, resolve })
      this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq)
    })
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) next.resolve()
    else this.active--
  }
}

/**
 * Milliseconds to wait before retrying a request Barrelman refused for load,
 * or null when the failure is not one a retry can fix.
 */
export function rejectionRetryMs(error: unknown): number | null {
  const response = (error as { response?: { status?: number; headers?: Record<string, unknown> } })
    ?.response
  if (response?.status !== 429) return null
  return retryAfterMs(response.headers?.['retry-after'])
}

/** Retry-After as delay-seconds or an HTTP date; a missing hint means a second. */
export function retryAfterMs(header: unknown, now = Date.now()): number {
  const value = Array.isArray(header) ? header[0] : header
  if (value == null || value === '') return 1000
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(String(value))
  return Number.isNaN(date) ? 1000 : Math.max(0, date - now)
}
