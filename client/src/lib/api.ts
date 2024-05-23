import { capitalize } from '@/filters/text.filters'
import axios, { AxiosError } from 'axios'
import { toast } from 'vue-sonner'

export const api = axios.create({
  withCredentials: true,
  baseURL:
    process.env.NODE_ENV !== 'production'
      ? 'https://parchment.onrender.com'
      : 'http://localhost:5000',
})

function getErrorMessage(error: AxiosError): {
  title: string
  description?: string
} {
  const { response } = error
  const data = response?.data as any

  if (data?.errors) {
    return {
      title: `${capitalize(data.type)} error`,
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

  return {
    title: 'An unknown error occurred',
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
