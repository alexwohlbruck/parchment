/**
 * Client-side realtime WebSocket manager.
 *
 * One long-lived socket per tab. Auth is delegated to the ticket endpoint:
 * we POST `/realtime/ticket`, get back a short-lived token, open the WS
 * with `?ticket=…`. Reconnect uses exponential backoff capped at 30s.
 *
 * Bootstrap once at app mount (after auth becomes ready), disconnect on
 * sign-out. Store-side handlers are registered in `realtime-events.ts`
 * and fire from every received frame; this file just owns the socket
 * lifecycle.
 *
 * Design choices:
 *   - Native `WebSocket` only (no library). The reconnect state machine
 *     is tiny — adding `reconnecting-websocket` or similar would be
 *     more code than we'd save.
 *   - `connectionState` is a reactive ref so UI can show a disconnected
 *     banner without component trees threading the state manually.
 *   - A synthetic `realtime:reconnected` event fires on every open AFTER
 *     the first. Stores that care (library, friends) refetch to cover
 *     events they missed while offline.
 */

import { ref, readonly, type Ref } from 'vue'
import { api, useServerUrl } from './api'
import { dispatch } from './realtime-events'

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed'

const state = ref<ConnectionState>('idle')
let socket: WebSocket | null = null
let desiredConnected = false
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
/**
 * Set to true after the first successful `open`. Used to decide whether
 * the next `open` is a first-connect (no catchup needed) or a reconnect
 * (emit the synthetic catchup event).
 */
let haveConnectedBefore = false

/** Exponential backoff capped at 30s. Resets to 0 on each successful open. */
function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 500 * 2 ** attempt)
  // 10% jitter to avoid thundering-herd reconnects after a server blip.
  return Math.round(base * (0.9 + Math.random() * 0.2))
}

/**
 * Mint a ticket via the authenticated HTTP endpoint. The axios client
 * already carries session cookies / bearer; this reuses that auth to
 * authenticate the WS upgrade.
 */
async function mintTicket(): Promise<string> {
  const { data } = await api.post<{ ticket: string; expiresAt: number }>(
    '/realtime/ticket',
  )
  return data.ticket
}

/** Derive the WS URL from the current API base. http→ws, https→wss. */
function buildWsUrl(serverUrl: string, ticket: string): string {
  const base = serverUrl.replace(/^http/, 'ws').replace(/\/$/, '')
  return `${base}/realtime?ticket=${encodeURIComponent(ticket)}`
}

function scheduleReconnect(): void {
  if (!desiredConnected || reconnectTimer) return
  const delay = backoffMs(reconnectAttempts)
  reconnectAttempts += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void openSocket()
  }, delay)
}

async function openSocket(): Promise<void> {
  if (!desiredConnected) return
  if (socket && socket.readyState !== WebSocket.CLOSED) return

  state.value = 'connecting'
  let ticket: string
  try {
    ticket = await mintTicket()
  } catch (err) {
    // Ticket mint failure is usually an auth problem (session expired).
    // Don't hammer the server — back off like a normal WS failure.
    console.warn('[realtime] ticket mint failed, will retry', err)
    state.value = 'closed'
    scheduleReconnect()
    return
  }

  const serverUrl = useServerUrl().value
  const url = buildWsUrl(serverUrl, ticket)
  const ws = new WebSocket(url)
  socket = ws

  ws.addEventListener('open', () => {
    state.value = 'open'
    reconnectAttempts = 0
    const isReconnect = haveConnectedBefore
    haveConnectedBefore = true
    if (isReconnect) {
      // Fire a synthetic event so subscribed stores can refetch and cover
      // any events they missed while we were offline. Payload is empty
      // by design — the stores know what to refetch.
      dispatch('realtime:reconnected', {})
    }
  })

  ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return
    let parsed: { event?: string; payload?: unknown }
    try {
      parsed = JSON.parse(ev.data)
    } catch (err) {
      console.warn('[realtime] bad frame', err)
      return
    }
    if (!parsed.event) return
    dispatch(parsed.event, parsed.payload)
  })

  ws.addEventListener('close', () => {
    state.value = 'closed'
    socket = null
    scheduleReconnect()
  })

  ws.addEventListener('error', () => {
    // Browser doesn't surface the reason here; close will fire next and
    // trigger reconnect. Logging at info level so dev tools show it
    // without a noisy stack trace.
    console.info('[realtime] socket error — will reconnect')
  })
}

/**
 * Start the realtime connection. Call once from `App.vue` after auth is
 * ready. Idempotent — subsequent calls are no-ops while connected.
 */
export function connect(): void {
  desiredConnected = true
  void openSocket()
}

/**
 * Stop the realtime connection permanently (until the next `connect`).
 * Call on sign-out so events aren't received for the wrong session.
 */
export function disconnect(): void {
  desiredConnected = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (socket) {
    try {
      socket.close(1000, 'client disconnect')
    } catch {
      /* already closed */
    }
    socket = null
  }
  reconnectAttempts = 0
  haveConnectedBefore = false
  state.value = 'idle'
}

/**
 * Reactive connection state for UI. Read-only — callers shouldn't write
 * to it directly; drive transitions through connect/disconnect.
 */
export const connectionState: Readonly<Ref<ConnectionState>> = readonly(state)

/** Testing hook: force a specific state + clear internal flags. */
export function _resetForTests(): void {
  disconnect()
}
