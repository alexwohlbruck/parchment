import axios, { AxiosError } from 'axios'
import { toast } from 'vue-sonner'
import { useStorage } from '@vueuse/core'
import { watchEffect } from 'vue'
import { DEFAULT_SERVER_URL, APP_NAME_SHORT } from '@/lib/constants'
import router, { AppRoute } from '@/router'
import { i18n } from '@/lib/i18n'
import { capitalize } from '@/filters/text.filters'

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
      title: (i18n.global as any).t('messages.error.validation', {
        type: capitalize(data.type),
      }),
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
