import { cors, HTTPMethod } from '@elysiajs/cors'
import { clientHostname, clientOrigin } from './origins.config'

type CORSConfig = Parameters<typeof cors>[0]

const allowedMethods: HTTPMethod[] = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
]

const devOrigins =
  process.env.NODE_ENV !== 'production'
    ? [
        'tauri://localhost',
        'http://tauri.localhost',
        'http://10.0.2.2:5173', // Android emulator
      ]
    : []

const corsConfig: CORSConfig = {
  origin: [clientOrigin!, clientHostname, ...devOrigins],
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Set-Cookie',
    'X-Requested-With',
    'Accept',
  ],
  exposeHeaders: '*',
  methods: allowedMethods,
}

export default corsConfig
