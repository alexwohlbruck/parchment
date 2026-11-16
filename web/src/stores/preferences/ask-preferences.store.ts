import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { DEFAULT_ASK_PREFERENCES } from '@server/types/ask-preferences.types'
import type { AskPreferences } from '@/types/ask.types'

/** Ask settings. The account's copy wins; this device keeps the last one seen. */
export const useAskPreferencesStore = defineStore('askPreferences', () => {
  const preferences = useStorage<AskPreferences>('ask-preferences', { ...DEFAULT_ASK_PREFERENCES }, undefined, {
    mergeDefaults: true,
  })

  function adopt(remote: AskPreferences) {
    preferences.value = { ...remote }
  }

  function set(patch: Partial<AskPreferences>) {
    preferences.value = { ...preferences.value, ...patch }
  }

  return { preferences, adopt, set }
})
