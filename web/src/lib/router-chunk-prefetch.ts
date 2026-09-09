import type { Router } from 'vue-router'
import { isOffline, onReconnected } from '@/lib/connectivity'

/**
 * Warm the lazily-loaded view chunks while we still have a connection.
 *
 * Most views are `() => import(...)`, so their chunk is only fetched the
 * first time you open them. Offline that fetch can't happen, and the
 * service worker can't help either — it caches a chunk as it's requested,
 * so a view you never opened online was never cached. Opening it offline
 * failed outright.
 *
 * Pulling them in during idle time after startup means every view is in
 * the module registry (and the SW's `app-assets` cache) before it's
 * needed. Runs once per session, skipped on metered/save-data connections.
 */

let started = false

function isLazyLoader(value: unknown): value is () => Promise<unknown> {
  if (typeof value !== 'function') return false
  // SFCs compile to objects; a function here is a loader — unless it's a
  // functional component, which carries these markers.
  const candidate = value as unknown as Record<string, unknown>
  return !candidate.__vccOpts && !candidate.render && !candidate.setup
}

function whenIdle(fn: () => void): void {
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
  }).requestIdleCallback
  if (idle) idle(fn, { timeout: 10_000 })
  else setTimeout(fn, 2_000)
}

function saveDataEnabled(): boolean {
  return Boolean(
    (navigator as unknown as { connection?: { saveData?: boolean } }).connection
      ?.saveData,
  )
}

async function prefetchAll(router: Router): Promise<void> {
  const loaders = router
    .getRoutes()
    .flatMap(route => Object.values(route.components ?? {}))
    .filter(isLazyLoader)

  for (const load of loaders) {
    if (isOffline.value) return
    try {
      await load()
    } catch {
      // A chunk that won't load isn't worth stopping the rest for; the
      // router's own error handling covers the user-facing case.
    }
  }
}

export function prefetchRouteChunks(router: Router): void {
  if (started || saveDataEnabled()) return
  if (isOffline.value) {
    // Nothing to fetch yet — try again once there's a connection.
    onReconnected(() => prefetchRouteChunks(router))
    return
  }
  started = true
  whenIdle(() => void prefetchAll(router))
}
