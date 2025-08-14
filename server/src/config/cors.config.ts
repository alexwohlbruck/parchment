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

const corsConfig: CORSConfig = {
  origin: [
    clientOrigin!,
    clientHostname,
    // TODO: Only add these in development environment
    'tauri://localhost',
    'http://tauri.localhost',
    'http://10.0.2.2:5173', // Android emulator
  ],
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
