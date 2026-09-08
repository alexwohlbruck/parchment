import { capitalize } from '@/filters/text.filters'
import axios, { AxiosError } from 'axios'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useStorage } from '@vueuse/core'
import { watchEffect, ref, computed } from 'vue'
import { DEFAULT_SERVER_URL, APP_NAME_SHORT } from '@/lib/constants'
import router, { AppRoute } from '@/router'
import { i18n, storedLocale } from '@/lib/i18n'
import {
  configureConnectivityProbe,
  isOffline,
  reportServerReachable,
  reportServerUnreachable,
} from '@/lib/connectivity'
import {
  NetworkErrorKind,
  OfflineRequestError,
  classifyNetworkError,
  tagNetworkError,
} from '@/lib/network-errors'

// Detect Tauri environment using the Tauri API
// Try to use @tauri-apps/api/os for reliable detection
let _isTauriCache: boolean | null = null
let _isTauriPromise: Promise<boolean> | null = null

async function detectTauriAsync(): Promise<boolean> {
  try {
    // Try to use the Tauri OS plugin - if it's available, we're in Tauri
    const { platform } = await import('@tauri-apps/plugin-os')
    const osPlatform = await platform() // If this succeeds, we're in Tauri
    if (import.meta.env.DEV) {
      console.log('[Tauri Detection] Platform detected:', osPlatform)
    }
    return true
  } catch (e) {
    // If import fails or API call fails, we're not in Tauri
    if (import.meta.env.DEV) {
      console.log('[Tauri Detection] Async detection failed:', e)
    }
    return false
  }
}

// Synchronous check as fallback
function checkTauriSync(): boolean {
  if (typeof window === 'undefined') return false

  const win = window as any
  // Check multiple possible Tauri indicators
  return (
    typeof win.__TAURI__ !== 'undefined' ||
    typeof win.__TAURI_METADATA__ !== 'undefined' ||
    typeof win.__TAURI_INTERNALS__ !== 'undefined' ||
    typeof win.__TAURI_IPC__ !== 'undefined' ||
    window.location.protocol === 'tauri:'
  )
}

// Initialize detection
if (typeof window !== 'undefined') {
  // Start async detection immediately
  _isTauriPromise = detectTauriAsync().then(result => {
    _isTauriCache = result
    if (import.meta.env.DEV) {
      console.log('[Tauri Detection] Async detection result:', result)
    }
    return result
  })

  // Also check sync as fallback
  _isTauriCache = checkTauriSync()

  // Re-check sync after delays
  const recheck = () => {
    const syncResult = checkTauriSync()
    if (syncResult !== _isTauriCache) {
      _isTauriCache = syncResult
      if (import.meta.env.DEV) {
        console.log('[Tauri Detection] Sync check updated to:', syncResult)
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', recheck)
  }
  setTimeout(recheck, 100)
  setTimeout(recheck, 500)
}

// Export as a value (uses sync check initially, will be updated by async)
export const isTauri = _isTauriCache ?? false

// Export async function for components that need accurate detection
export async function getIsTauri(): Promise<boolean> {
  if (_isTauriPromise) {
    return _isTauriPromise
  }
  _isTauriPromise = detectTauriAsync()
  return _isTauriPromise
}

// Reactive server URL from localStorage, defaults to api.parchment.app
const serverUrl = useStorage('parchment-selected-server', DEFAULT_SERVER_URL)

// Which build-time default the stored selection came from. `useStorage` only
// consults the default when the key is absent, so a deployment that later
// declares a different API origin (a branch preview moving to its own host, a
// self-hosted instance changing address) would be ignored forever in favour of
// a stale value — the app keeps calling a server that isn't there, and sign-in
// appears not to persist because the session cookie belongs to another origin.
//
// Adopt a changed default only when the user was still on the previous one:
// an explicitly chosen server (via the sign-in screen's server picker) is a
// deliberate choice and must survive.
const defaultServerUrl = useStorage(
  'parchment-default-server',
  DEFAULT_SERVER_URL,
)
if (defaultServerUrl.value !== DEFAULT_SERVER_URL) {
  if (serverUrl.value === defaultServerUrl.value) {
    serverUrl.value = DEFAULT_SERVER_URL
  }
  defaultServerUrl.value = DEFAULT_SERVER_URL
}

/** Request timeout (ms). Prevents "loads forever" when the server doesn't respond. */
const REQUEST_TIMEOUT_MS = 15000

export const api = axios.create({
  withCredentials: !isTauri, // Only use credentials for web
  baseURL: serverUrl.value,
  timeout: REQUEST_TIMEOUT_MS,
})

watchEffect(() => {
  api.defaults.baseURL = serverUrl.value
})

// Send locale to backend for localized responses (e.g. weather, directions, place names)
api.interceptors.request.use(config => {
  config.headers.set('Accept-Language', storedLocale.value)
  return config
})

// While offline, don't attempt reads at all — fail them instantly with a
// typed, quiet error so callers fall back to cached data instead of each
// burning a 15s timeout. Writes pass through: they're either queued by the
// sync layer before reaching axios or allowed to fail loudly. Opt out with
// `allowOffline: true` (e.g. connectivity probes).
api.interceptors.request.use(config => {
  const isRead = (config.method ?? 'get').toLowerCase() === 'get'
  if (isRead && isOffline.value && !config.allowOffline) {
    return Promise.reject(new OfflineRequestError(config))
  }
  return config
})

// The probe used to recover from "server unreachable": any HTTP response,
// including an error status, proves the wire works again.
configureConnectivityProbe(async () => {
  try {
    await api.get('/', { allowOffline: true, silent: true, timeout: 5000 })
    return true
  } catch (error) {
    return axios.isAxiosError(error) && error.response !== undefined
  }
})

/**
 * Set the server URL
 */
export function setServerUrl(url: string): void {
  serverUrl.value = url
}

/**
 * Get the reactive server URL ref
 */
export function useServerUrl() {
  return serverUrl
}

function getErrorMessage(
  error: AxiosError,
  kind: NetworkErrorKind,
): {
  title: string
  description?: string
} {
  const { response } = error
  const data = response?.data as any

  if (kind === NetworkErrorKind.Timeout) {
    return {
      title: (i18n.global as any).t('messages.error.timeout.title'),
      description: (i18n.global as any).t('messages.error.timeout.description'),
    }
  }

  if (kind === NetworkErrorKind.Unreachable) {
    return {
      title: (i18n.global as any).t('messages.error.network.title'),
      description: (i18n.global as any).t(
        'messages.error.network.description',
        {
          appName: APP_NAME_SHORT,
        },
      ),
    }
  }

  if (data?.errors) {
    return {
      title: (i18n.global as any).t('messages.unknownError'),
      description: `${data.message} on ${data.on}: ${data.property}`,
    }
  }

  if (data?.message) {
    return {
      title: data.message,
    }
  }

  if (response?.status || response?.statusText) {
    return {
      title: response.statusText || response.status.toString(),
    }
  }

  if (error.message) {
    return {
      title: error.message,
    }
  }

  return {
    title: (i18n.global as any).t('messages.unknownError'),
  }
}

api.interceptors.response.use(
  response => {
    reportServerReachable()
    return response
  },
  error => {
    const kind = classifyNetworkError(error)
    tagNetworkError(error, kind)

    // A response — any response — proves the server is reachable; the
    // opposite means it isn't and the connectivity layer should start
    // probing for its return.
    if (error?.response) {
      reportServerReachable()
    } else if (
      kind === NetworkErrorKind.Unreachable ||
      kind === NetworkErrorKind.Timeout
    ) {
      reportServerUnreachable()
    }

    // Being offline is a state, not an error — the connectivity layer and
    // offline UI own communicating it. Cancels are intentional.
    if (
      kind === NetworkErrorKind.Offline ||
      kind === NetworkErrorKind.Cancelled
    ) {
      return Promise.reject(error)
    }

    const status = error.response?.status as number | undefined

    // Session probe — any failure is handled silently by the caller.
    if (error.request?.responseURL?.includes('/auth/sessions/current')) {
      return Promise.reject(error)
    }

    const { title, description } = getErrorMessage(error, kind)

    if (status === 401) {
      router.push({ name: AppRoute.SIGNIN })
    }

    // Callers can suppress error toasts entirely via `silent: true`
    // on the request config, or opt individual statuses out via
    // `silentStatuses: [425, ...]` — useful for polling loops where an
    // "expected" 4xx would otherwise spam the user with errors.
    const cfg = error.config as
      | { silent?: boolean; silentStatuses?: number[] }
      | undefined
    if (
      cfg?.silent ||
      (status !== undefined && cfg?.silentStatuses?.includes(status))
    ) {
      return Promise.reject(error)
    }

    // Unreachable/timeout failures tend to arrive in bursts (every feature
    // that had a request in flight). Share one toast id so they collapse
    // into a single message instead of stacking.
    const connectionProblem =
      kind === NetworkErrorKind.Unreachable || kind === NetworkErrorKind.Timeout
    toast.error(title, {
      description,
      ...(connectionProblem ? { id: 'network-error' } : {}),
    })

    return Promise.reject(error)
  },
)
