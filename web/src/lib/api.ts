import { capitalize } from '@/filters/text.filters'
import axios, { AxiosError } from 'axios'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useStorage } from '@vueuse/core'
import { watchEffect } from 'vue'
import { DEFAULT_SERVER_URL } from '@/lib/constants'

export const isTauri = !!window.isTauri

// Reactive server URL from localStorage, defaults to api.parchment.app
const serverUrl = useStorage('parchment-selected-server', DEFAULT_SERVER_URL)

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

  // TODO: How to get i18n in interceptor?
  // const { t } = useI18n()

  return {
    title: 'An unknown error occurred', //t('messages.unknownError'),
  }
}

api.interceptors.response.use(
  response => {
    return response
  },
  error => {
    const { title, description } = getErrorMessage(error)
    toast.error(title, { description })
    return Promise.reject(error)
  },
)
