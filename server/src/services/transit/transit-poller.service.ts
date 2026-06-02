/**
 * Transit Vehicle Poller
 *
 * Server-side singleton that polls Barrelman for GTFS-RT vehicle
 * positions and broadcasts them to subscribed WebSocket connections.
 * Replaces the old pattern where every client independently polled
 * the proxy endpoint.
 *
 * Lifecycle:
 *   - Clients send `transit:subscribe { bounds }` via WS
 *   - Poller starts on first subscriber, stops when none remain
 *   - Every POLL_INTERVAL_MS, fetches from Barrelman using the union
 *     of all subscriber viewports, then broadcasts the full vehicle
 *     list to every subscriber
 *   - `transit:viewport { bounds }` updates a subscriber's bounds
 *   - `transit:unsubscribe` or socket close removes the subscriber
 */

import { logger } from '../../lib/logger'
import {
  allConnections,
  type Connection,
} from '../realtime/registry.service'
import { IntegrationId } from '../../types/integration.enums'

/** How often we poll Barrelman (ms). */
const POLL_INTERVAL_MS = 10_000

/** Expand viewport bounds by this fraction to prefetch nearby vehicles. */
const BOUNDS_PADDING = 0.3

interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

interface Subscriber {
  connectionId: string
  connection: Connection
  bounds: Bounds
}

// ── State ──────────────────────────────────────────────────────

const subscribers = new Map<string, Subscriber>()
let pollTimer: ReturnType<typeof setInterval> | null = null
let integrationManager: any = null

// ── Public API ─────────────────────────────────────────────────

/**
 * Provide the integration manager so we can look up the Barrelman
 * host at poll time. Called once at server bootstrap.
 */
export function setIntegrationManager(mgr: any): void {
  integrationManager = mgr
}

/**
 * Subscribe a WebSocket connection to transit vehicle updates.
 */
export function subscribe(
  connectionId: string,
  connection: Connection,
  bounds: Bounds,
): void {
  subscribers.set(connectionId, { connectionId, connection, bounds })
  logger.debug({ connectionId, bounds }, 'Transit: subscribed')

  // Start polling if this is the first subscriber
  if (subscribers.size === 1 && !pollTimer) {
    startPolling()
  }

  // Immediate first push so the client doesn't wait a full interval
  void pollOnce()
}

/**
 * Update a subscriber's viewport bounds.
 */
export function updateBounds(connectionId: string, bounds: Bounds): void {
  const sub = subscribers.get(connectionId)
  if (sub) {
    sub.bounds = bounds
  }
}

/**
 * Unsubscribe a connection from transit vehicle updates.
 */
export function unsubscribe(connectionId: string): void {
  subscribers.delete(connectionId)
  logger.debug({ connectionId }, 'Transit: unsubscribed')

  // Stop polling if no subscribers remain
  if (subscribers.size === 0 && pollTimer) {
    stopPolling()
  }
}

/**
 * Called when any WS connection closes — clean up its transit
 * subscription if it had one.
 */
export function onConnectionClosed(connectionId: string): void {
  if (subscribers.has(connectionId)) {
    unsubscribe(connectionId)
  }
}

// ── Internals ──────────────────────────────────────────────────

function startPolling(): void {
  if (pollTimer) return
  logger.info('Transit poller: started')
  pollTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS)
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  logger.info('Transit poller: stopped (no subscribers)')
}

/**
 * Compute the union of all subscriber viewports, expanded by padding.
 */
function unionBounds(): Bounds | null {
  if (subscribers.size === 0) return null

  let north = -90
  let south = 90
  let east = -180
  let west = 180

  for (const sub of subscribers.values()) {
    const b = sub.bounds
    if (b.north > north) north = b.north
    if (b.south < south) south = b.south
    if (b.east > east) east = b.east
    if (b.west < west) west = b.west
  }

  // Expand bounds to prefetch nearby vehicles
  const latPad = (north - south) * BOUNDS_PADDING
  const lngPad = (east - west) * BOUNDS_PADDING

  return {
    north: Math.min(90, north + latPad),
    south: Math.max(-90, south - latPad),
    east: Math.min(180, east + lngPad),
    west: Math.max(-180, west - lngPad),
  }
}

/**
 * Get the Barrelman host and API key from the integration config.
 */
function getBarrelmanConfig(): { host: string; apiKey?: string } | null {
  if (!integrationManager) return null

  const integration = integrationManager
    .getConfiguredIntegrations()
    .find((i: any) => i.integrationId === IntegrationId.BARRELMAN)

  const config = integration?.config as
    | { host?: string; apiKey?: string }
    | undefined

  if (!config?.host) return null
  return { host: config.host, apiKey: config.apiKey }
}

async function pollOnce(): Promise<void> {
  const bounds = unionBounds()
  if (!bounds) return

  const barrelmanConfig = getBarrelmanConfig()
  if (!barrelmanConfig) return

  try {
    const params = new URLSearchParams({
      north: String(bounds.north),
      south: String(bounds.south),
      east: String(bounds.east),
      west: String(bounds.west),
    })

    const headers: Record<string, string> = {}
    if (barrelmanConfig.apiKey) {
      headers['Authorization'] = `Bearer ${barrelmanConfig.apiKey}`
    }

    const response = await fetch(
      `${barrelmanConfig.host}/transit/vehicles?${params}`,
      { headers, signal: AbortSignal.timeout(8000) },
    )

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        'Transit poller: Barrelman returned error',
      )
      return
    }

    const data = (await response.json()) as {
      vehicles: any[]
      feedTimestamps?: Record<string, string>
    }

    // Build the broadcast frame once
    const frame = JSON.stringify({
      event: 'transit:vehicles',
      payload: {
        vehicles: data.vehicles,
        feedTimestamps: data.feedTimestamps,
      },
    })

    // Send to all subscribers — stale connections are cleaned up by
    // the registry on send failure
    for (const sub of subscribers.values()) {
      try {
        sub.connection.send(frame)
      } catch {
        // Connection died — will be cleaned up when the close handler fires
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Transit poller: fetch failed')
  }
}
