import axios from 'axios'

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
    // TODO: Show error message on request failure
    // showToast(store, {
    //   text: message,
    //   action,
    // })

    return Promise.reject(error)
  },
)
