import axios from 'axios'
import { toast } from 'vue-sonner'

export const api = axios.create({
  withCredentials: true,
  baseURL: 'http://localhost:5000',
})

// Pre-request hook
// api.interceptors.request.use(
//   config => {
//     return config
//   },
//   error => {
//     return Promise.reject(error)
//   },
// )

// Post-request hook
api.interceptors.response.use(
  response => {
    return response
  },
  error => {
    toast.error(error.message)

    return Promise.reject(error)
  },
)
