import { Store, load } from '@tauri-apps/plugin-store'
import { isTauri } from './api'

let store: Store | null = null

/**
 * Get or initialize the store instance
 */
async function getStore() {
  if (!isTauri) return null

  if (!store) {
    store = await load('store.json', {
      autoSave: true,
      defaults: {},
    })
  }

  return store
}

/**
 * Save a value in the store
 */
export async function save<T>(key: string, value: T): Promise<void> {
  const store = await getStore()
  if (store) {
    await store.set(key, value)
  }
}

/**
 * Get a value from the store
 */
export async function get<T>(key: string): Promise<T | null> {
  const store = await getStore()
  if (!store) return null

  try {
    const value = await store.get<T>(key)
    return value ?? null
  } catch {
    return null
  }
}

/**
 * Remove a value from the store
 */
export async function remove(key: string): Promise<void> {
  const store = await getStore()
  if (store) {
    await store.delete(key)
  }
}

// Convenience methods for auth token
export const auth = {
  setToken: (token: string) => save('auth_token', token),
  getToken: () => get<string>('auth_token'),
  clearToken: () => remove('auth_token'),
}

// Convenience methods for location encryption keys and tracking
export const location = {
  setPrivateKey: (key: string) => save('location_private_key', key),
  getPrivateKey: () => get<string>('location_private_key'),
  clearPrivateKey: () => remove('location_private_key'),
  setSharedKeys: <T = Record<string, unknown>>(keys: T) => save('location_shared_keys', keys),
  getSharedKeys: <T = Record<string, unknown>>() => get<T>('location_shared_keys'),
  clearSharedKeys: () => remove('location_shared_keys'),
  setDeviceId: (id: string) => save('location_device_id', id),
  getDeviceId: () => get<string>('location_device_id'),
  setFingerprint: (fingerprint: string) => save('location_fingerprint', fingerprint),
  getFingerprint: () => get<string>('location_fingerprint'),
  setBuffer: <T = unknown>(buffer: T[]) => save('location_buffer', buffer),
  getBuffer: <T = unknown>() => get<T[]>('location_buffer'),
  clearBuffer: () => remove('location_buffer'),
  setTrackingEnabled: (enabled: boolean) => save('location_tracking_enabled', enabled),
  getTrackingEnabled: () => get<boolean>('location_tracking_enabled'),
}
