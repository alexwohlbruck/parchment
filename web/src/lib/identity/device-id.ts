/**
 * Per-device identifier for the server-held wrap-secret lookup.
 *
 * Not sensitive: a random UUID that the server uses as the second half of
 * the composite key on `device_wrap_secrets`. Persisted in `localStorage`
 * so the same browser keeps the same id across reloads. Desktop Tauri
 * doesn't need this (seed is in the OS keychain) but it's harmless if
 * loaded there.
 */

const DEVICE_ID_KEY = 'parchment-device-id'

export function getOrCreateDeviceId(): string {
  if (typeof localStorage === 'undefined') {
    // Non-browser contexts (SSR, worker) — caller shouldn't be reaching
    // key-storage here, but return something deterministic rather than
    // throwing.
    return 'server-side-placeholder'
  }
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem(DEVICE_ID_KEY, id)
  return id
}
