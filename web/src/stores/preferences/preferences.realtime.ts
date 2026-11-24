import { registerRealtimeHandlers } from '@/lib/realtime/realtime-events'
import { fetchPreferences, PREFERENCES_ORIGIN, type UserPreferences } from '@/services/preferences.service'
import { useAuthStore } from '@/stores/auth.store'
import { adoptAccountPreferences } from './account-preferences'

registerRealtimeHandlers('preferences', {
  'preferences:updated': payload => {
    const { origin, ...preferences } = payload as UserPreferences & { origin?: string }
    if (origin === PREFERENCES_ORIGIN || !useAuthStore().me) return
    adoptAccountPreferences(preferences)
  },
  'realtime:reconnected': async () => {
    const preferences = await fetchPreferences()
    if (preferences && useAuthStore().me) adoptAccountPreferences(preferences)
  },
})
