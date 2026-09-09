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
    ? [
        /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/,
        // Dev only: let the deployed frontend point at a local backend — e.g.
        // debugging the prod client (map.parchment.app) against localhost:5000.
        /^https:\/\/([a-z0-9-]+\.)*parchment\.app$/,
        // Branch previews (scripts/preview.sh) serve each worktree from a
        // tailnet host on its own port, so the client origin is a *.ts.net
        // URL rather than localhost. Reachable only from the tailnet.
        /^https?:\/\/([a-z0-9-]+\.)+ts\.net(:\d+)?$/,
        // Same previews before tailnet HTTPS certificates are enabled, where
        // the client is served straight off the box's 100.x tailnet address.
        /^http:\/\/100\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
      ]
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
    // Per-request credentials forwarded for `scheme: 'user-e2ee'` integrations
    // (e.g. Dawarich location history). Required so the browser preflight
    // doesn't reject the request before it reaches the server.
    'X-Integration-Endpoint',
    'X-Integration-Token',
  ],
  exposeHeaders: '*',
  methods: allowedMethods,
}

export default corsConfig
