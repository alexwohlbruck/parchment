import { capitalize } from '@/filters/text.filters'
import axios, { AxiosError } from 'axios'
import { toast } from 'vue-sonner'
import { useStorage } from '@vueuse/core'
import { watchEffect } from 'vue'
import { APP_NAME_SHORT, DEFAULT_SERVER_URL } from '@/lib/constants'
import router from '@/router'
import { AppRoute } from '@/router'
import { i18n } from '@/lib/i18n'

export const isTauri = !!window.isTauri

// Reactive server URL from localStorage, defaults to api.parchment.app
const serverUrl = useStorage<string>(
  'parchment-selected-server',
  DEFAULT_SERVER_URL,
)

export const api = axios.create({
  withCredentials: !isTauri, // Only use credentials for web
  baseURL: serverUrl.value,
})

watchEffect(() => {
  api.defaults.baseURL = serverUrl.value
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

/**
 * Detect if an error is a network error
 */
function isNetworkError(error: AxiosError): boolean {
  if (error.code === 'ERR_NETWORK' && !error.response) {
    return true
  }

  if (error.request && error.request.status === 0 && !error.response) {
    return true
  }

  return false
}

/**
 * Handle network errors by showing toast and redirecting
 */
function handleNetworkError(): void {
  toast.error((i18n.global as any).t('messages.networkError'), {
    description: (i18n.global as any).t('messages.networkErrorDescription', {
      appName: APP_NAME_SHORT,
    }),
  })

  router.push({ name: AppRoute.SIGNIN })
}

/**
 * Handle general errors by showing toast
 */
function handleGeneralError(error: AxiosError): void {
  const { title, description } = getErrorMessage(error)
  toast.error(title, { description })
}

// Error deduplication flags
let networkErrorShown = false
let generalErrorCooldown = new Set<string>()

// Reset flags periodically
setInterval(() => {
  networkErrorShown = false
  generalErrorCooldown.clear()
}, 2000)

// Deduplicated error handlers
function debouncedNetworkError() {
  if (!networkErrorShown) {
    networkErrorShown = true
    handleNetworkError()
  }
}

function debouncedGeneralError(error: AxiosError) {
  const errorKey = `${error.response?.status}-${error.message}`
  if (!generalErrorCooldown.has(errorKey)) {
    generalErrorCooldown.add(errorKey)
    handleGeneralError(error)
  }
}

function getErrorMessage(error: AxiosError): {
  title: string
  description?: string
} {
  const { response } = error
  const data = response?.data as any

  if (data?.errors) {
    return {
      title: `${capitalize(data.type)} error`, // TODO: i18n
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

// Response interceptor for error handling
api.interceptors.response.use(
  response => {
    return response
  },
  error => {
    if (isNetworkError(error)) {
      debouncedNetworkError()
    } else {
      debouncedGeneralError(error)
    }
    return Promise.reject(error)
  },
)
