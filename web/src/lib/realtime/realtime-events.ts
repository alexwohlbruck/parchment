/**
 * Realtime event dispatcher — the client-side router that takes incoming
 * WebSocket frames and calls matching handler functions.
 *
 * Stores register their handlers via `registerRealtimeHandlers` at module
 * import time. When a frame arrives, `dispatch` looks up every handler
 * for the event name and invokes them in order. Multiple stores can
 * subscribe to the same event (uncommon but useful — e.g. a bookmark
 * delete also updates the collections store's cached count).
 *
 * Why this registry instead of a big switch:
 *
 *   - Co-location: handlers live in the store that owns the state. This
 *     file doesn't need to import every store just to route events.
 *   - Hot-reload friendly: `ownerKey` lets us atomically replace one
 *     store's handler set during Vite HMR without touching others.
 *   - Idempotent dispatch: if a store hasn't registered yet (module not
 *     yet imported), the event is just a no-op — refetch on next mount
 *     fills in what was missed.
 */

type Handler = (payload: unknown) => void

// ownerKey → event name → handler function. One handler per (owner, event).
const handlers = new Map<string, Map<string, Handler>>()

/**
 * Register this owner's handler map. Calling twice with the same ownerKey
 * replaces the previous registration entirely — important for HMR where
 * a store's module re-executes and we want fresh function references.
 */
export function registerRealtimeHandlers(
  ownerKey: string,
  map: Record<string, Handler>,
): void {
  const byEvent = new Map<string, Handler>()
  for (const [event, fn] of Object.entries(map)) {
    byEvent.set(event, fn)
  }
  handlers.set(ownerKey, byEvent)
}

/**
 * Fire every handler registered for this event. Errors in one handler
 * don't block others — we log and continue. Stores are expected to be
 * idempotent (see `applyRemote*` conventions) so a retry or duplicate
 * event lands safely.
 */
export function dispatch(event: string, payload: unknown): void {
  for (const byEvent of handlers.values()) {
    const fn = byEvent.get(event)
    if (!fn) continue
    try {
      fn(payload)
    } catch (err) {
      // Isolate failing handlers — one broken store must not block
      // events destined for other stores.
      console.error(`[realtime] handler for "${event}" threw:`, err)
    }
  }
}

/** Diagnostic: which owners have registered handlers. */
export function _registeredOwners(): string[] {
  return Array.from(handlers.keys())
}

/** Testing hook — clear all registrations. */
export function _resetForTests(): void {
  handlers.clear()
}
