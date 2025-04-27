import { cors, HTTPMethod } from '@elysiajs/cors'
import { clientHostname } from './origins.config'

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
  origin: [clientHostname, 'tauri://localhost', 'http://tauri.localhost'],
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
