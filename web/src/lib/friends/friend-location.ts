import type { LocationData } from '@/lib/identity/federation-crypto'

export const MIN_BROADCAST_INTERVAL_MS = 2_000
export const MIN_BROADCAST_DISTANCE_M = 3
export const STATIONARY_REFRESH_MS = 5 * 60_000
export const BROADCAST_HEARTBEAT_MS = 60_000
// A fix older than this isn't re-sent by the heartbeat: GPS has gone quiet.
export const MAX_RESEND_FIX_AGE_MS = 30 * 60_000
export const MAX_BROADCAST_BACKOFF_MS = 5 * 60_000

// Longer than a stationary sender's refresh plus one heartbeat of slack.
export const LOCATION_STALE_AFTER_MS = 2 * STATIONARY_REFRESH_MS

export function isLocationStale(updatedAt: Date, now: number): boolean {
  return now - updatedAt.getTime() > LOCATION_STALE_AFTER_MS
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** A decrypted payload is only drawn when its coordinates are real. */
export function isValidLocationData(v: unknown): v is LocationData {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    isFiniteNumber(o.lat) &&
    isFiniteNumber(o.lng) &&
    o.lat >= -90 &&
    o.lat <= 90 &&
    o.lng >= -180 &&
    o.lng <= 180 &&
    isFiniteNumber(o.timestamp)
  )
}

/** Later rows win; a re-delivery of the same row is harmless either way. */
export function isNewerSample(existing: Date | undefined, incoming: Date): boolean {
  if (Number.isNaN(incoming.getTime())) return false
  return !existing || incoming.getTime() >= existing.getTime()
}

export function broadcastBackoffMs(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(MAX_BROADCAST_BACKOFF_MS, MIN_BROADCAST_INTERVAL_MS * 2 ** failures)
}
