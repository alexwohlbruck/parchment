/**
 * Single source of truth for network connectivity.
 *
 * Nothing else in the app should read `navigator.onLine` or listen to the
 * browser's online/offline events — import `isOffline` / `connectivity`
 * from here (components go through `useConnectivity()`).
 *
 * Two signals feed the state:
 *   - The browser's own online/offline events (`navigatorOnline`). Offline
 *     here means "no network interface at all" and is trustworthy; online
 *     only means "some interface exists", not that the server is reachable.
 *   - Evidence from real requests (`serverReachable`). The API layer calls
 *     `reportServerReachable()` on any HTTP response (even an error status —
 *     a 404 still proves the wire works) and `reportServerUnreachable()`
 *     when a request dies without a response. While unreachable, a probe
 *     (injected by the API layer to avoid an import cycle) retries on a
 *     bounded backoff until the server answers again.
 */

import { computed, readonly, ref, watch } from 'vue'

export type ConnectivityStatus = 'online' | 'offline' | 'reconnecting'

const navigatorOnline = ref(
  typeof navigator === 'undefined' ? true : navigator.onLine,
)
const serverReachable = ref(true)

/** True when requests should not be attempted at all. */
export const isOffline = computed(
  () => !navigatorOnline.value || !serverReachable.value,
)

/**
 * `offline` — the device has no network. `reconnecting` — the device thinks
 * it has network but the server isn't answering (we're probing). `online` —
 * everything works.
 */
export const connectivityStatus = computed<ConnectivityStatus>(() => {
  if (!navigatorOnline.value) return 'offline'
  if (!serverReachable.value) return 'reconnecting'
  return 'online'
})

// ── Probing ─────────────────────────────────────────────────────────────

/**
 * Injected by the API layer (`configureConnectivityProbe`). Resolves true
 * when the server answered — with any HTTP status.
 */
let probe: (() => Promise<boolean>) | null = null
let probeTimer: ReturnType<typeof setTimeout> | null = null
let probeAttempts = 0

const PROBE_MIN_MS = 5_000
const PROBE_MAX_MS = 30_000

function probeDelayMs(): number {
  return Math.min(PROBE_MAX_MS, PROBE_MIN_MS * 2 ** probeAttempts)
}

function stopProbing(): void {
  if (probeTimer) {
    clearTimeout(probeTimer)
    probeTimer = null
  }
  probeAttempts = 0
}

function scheduleProbe(): void {
  if (probeTimer || !probe) return
  // No point probing without a network interface; the browser's `online`
  // event restarts probing the moment one appears.
  if (!navigatorOnline.value) return
  probeTimer = setTimeout(async () => {
    probeTimer = null
    if (serverReachable.value || !probe) return
    let reachable = false
    try {
      reachable = await probe()
    } catch {
      reachable = false
    }
    if (reachable) {
      reportServerReachable()
    } else {
      probeAttempts += 1
      scheduleProbe()
    }
  }, probeDelayMs())
}

export function configureConnectivityProbe(fn: () => Promise<boolean>): void {
  probe = fn
}

// ── Evidence from the request layer ─────────────────────────────────────

export function reportServerReachable(): void {
  stopProbing()
  serverReachable.value = true
}

export function reportServerUnreachable(): void {
  if (!serverReachable.value) return
  serverReachable.value = false
  scheduleProbe()
}

/** Force a probe now (user-initiated retry, browser regained network). */
export function checkConnectivityNow(): void {
  if (serverReachable.value) return
  stopProbing()
  scheduleProbe()
}

// ── Browser events ──────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    navigatorOnline.value = true
    // Regaining an interface says nothing about the server — verify.
    checkConnectivityNow()
  })
  window.addEventListener('offline', () => {
    navigatorOnline.value = false
  })
}

/**
 * Run a callback on each offline → online transition. Returns the stop
 * handle; component code should prefer `useConnectivity().onReconnected`,
 * which cleans up on unmount.
 */
export function onReconnected(cb: () => void): () => void {
  return watch(isOffline, (off, wasOff) => {
    if (!off && wasOff) cb()
  })
}

export const connectivity = {
  isOffline,
  status: connectivityStatus,
  navigatorOnline: readonly(navigatorOnline),
}

/** Testing hook: reset state between tests. */
export function _resetConnectivityForTests(): void {
  stopProbing()
  navigatorOnline.value =
    typeof navigator === 'undefined' ? true : navigator.onLine
  serverReachable.value = true
}
