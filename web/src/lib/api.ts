import { capitalize } from '@/filters/text.filters'
import axios, { AxiosError } from 'axios'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useStorage } from '@vueuse/core'
import { watchEffect, ref, computed } from 'vue'
import { DEFAULT_SERVER_URL, APP_NAME_SHORT } from '@/lib/constants'
import router, { AppRoute } from '@/router'
import { i18n, storedLocale } from '@/lib/i18n'

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

function getErrorMessage(error: AxiosError): {
  title: string
  description?: string
} {
  const { response, request, code } = error
  const data = response?.data as any

  if (!response && (request || code === 'ERR_NETWORK')) {
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
    return response
  },
  error => {
    // Cancelled requests (AbortController.abort()) are intentional — no toast
    if (axios.isCancel(error)) return Promise.reject(error)

    const { title, description } = getErrorMessage(error)

    if (error.response?.status === 401) {
      if (error.request.responseURL.includes('/auth/sessions/current')) {
        return
      } else {
        router.push({ name: AppRoute.SIGNIN })
      }
    }

    toast.error(title, { description })

    return Promise.reject(error)
  },
)
