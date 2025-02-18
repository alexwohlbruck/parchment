import { HTTPMethod } from '@elysiajs/cors'
import { clientHostname } from './origins.config'

const allowedMethods: HTTPMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
export default {
  origin: [clientHostname, 'tauri://localhost', 'http://tauri.localhost'],
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Set-Cookie',
    'X-Requested-With',
    'Accept',
  ],
  exposedHeaders: '*',
  methods: allowedMethods,
}
