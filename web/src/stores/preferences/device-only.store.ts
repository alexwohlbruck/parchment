import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { pathsUnder } from '@/lib/preferences/sync-scope'

/**
 * Settings this device keeps to itself instead of syncing to the account,
 * named by dot path from the preferences root (`app.theme.radius`, `account.language`).
 */
export const useDeviceOnlyStore = defineStore('deviceOnly', () => {
  const keys = useStorage<string[]>('device-only-settings', [])

  const isDeviceOnly = (key: string) => keys.value.includes(key)

  function setDeviceOnly(key: string, deviceOnly: boolean) {
    const others = keys.value.filter(existing => existing !== key)
    keys.value = deviceOnly ? [...others, key] : others
  }

  const pathsWithin = (prefix: string) => pathsUnder(keys.value, prefix)

  return { keys, isDeviceOnly, setDeviceOnly, pathsWithin }
})
