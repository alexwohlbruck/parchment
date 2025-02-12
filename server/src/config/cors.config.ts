import { HTTPMethod } from '@elysiajs/cors'
import { clientHostname } from './origins.config'

const allowedMethods: HTTPMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
export default {
  origin: [
    clientHostname,
    'tauri://localhost',
    'http://tauri.localhost',
    'http://tauri.localhost/',
    'http://10.0.2.2:5173',
  ],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Set-Cookie'],
  exposedHeaders: '*',
  methods: allowedMethods,
}
