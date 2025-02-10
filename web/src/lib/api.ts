import { capitalize } from '@/filters/text.filters'
import axios, { AxiosError } from 'axios'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

export const api = axios.create({
  withCredentials: true,
  baseURL:
    import.meta.env.VITE_SERVER_ORIGIN ??
    (process.env.NODE_ENV === 'production'
      ? 'https://api.parchment.app'
      : 'http://localhost:5000'),
})

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
