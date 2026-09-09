import { publish } from '../realtime/event-bus.service'

/**
 * Last known upstream health per (user, integration), kept in memory so
 * websocket events fire only on transitions — a flapping or busy client
 * doesn't flood every device with one event per request. Health is
 * transient and re-derived from live traffic after a restart.
 */
const lastState = new Map<string, 'ok' | 'failed'>()

const key = (userId: string, integrationId: string) =>
  `${userId}:${integrationId}`

export function reportIntegrationFailure(
  userId: string,
  integrationId: string,
): void {
  const k = key(userId, integrationId)
  if (lastState.get(k) === 'failed') return
  lastState.set(k, 'failed')
  publish(
    'integration:degraded',
    { integrationId },
    { localUserIds: [userId], remoteHandles: [] },
  )
}

export function reportIntegrationSuccess(
  userId: string,
  integrationId: string,
): void {
  const k = key(userId, integrationId)
  if (lastState.get(k) !== 'failed') return
  lastState.set(k, 'ok')
  publish(
    'integration:recovered',
    { integrationId },
    { localUserIds: [userId], remoteHandles: [] },
  )
}

/** Test hook — clears transition memory between cases. */
export function resetIntegrationHealthState(): void {
  lastState.clear()
}
