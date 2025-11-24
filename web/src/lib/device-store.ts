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
