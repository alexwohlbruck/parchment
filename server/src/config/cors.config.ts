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

// Tauri webview origins — must be allowed in production too, since the
// mobile/desktop apps load from these schemes regardless of build mode.
// - iOS / macOS / Windows / Linux: `tauri://localhost`
// - Android: `http://tauri.localhost` (and `https://tauri.localhost` on newer Tauri versions)
const tauriOrigins = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]

// Permissive localhost matcher for development: covers the Vite dev server on
// any port (5173, 5174 for the Claude Code preview, etc.) and the Android
// emulator's host alias (10.0.2.2).
const devOriginMatchers =
  process.env.NODE_ENV !== 'production'
    ? [/^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/]
    : []

const corsConfig: CORSConfig = {
  origin: [clientOrigin!, clientHostname, ...tauriOrigins, ...devOriginMatchers],
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
