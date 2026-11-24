import { storedLocale } from '@/lib/i18n'
import { toLocale, toUnitSystem, type UserPreferences } from '@/services/preferences.service'
import { useAppStore } from '@/stores/app.store'
import { useAppPreferencesStore } from './app-preferences.store'
import { useAskPreferencesStore } from './ask-preferences.store'
import { useDeviceOnlyStore } from './device-only.store'
import { useNavigationPreferencesStore } from './navigation-preferences.store'

/** Takes the account's preferences on this device, except the ones it keeps to itself. */
export function adoptAccountPreferences(preferences: UserPreferences) {
  const deviceOnly = useDeviceOnlyStore()
  if (!deviceOnly.isDeviceOnly('account.language')) storedLocale.value = toLocale(preferences.language)
  if (!deviceOnly.isDeviceOnly('account.unitSystem')) useAppStore().unitSystem = toUnitSystem(preferences.unitSystem)
  useNavigationPreferencesStore().adopt(preferences.navigation)
  if (preferences.ask) useAskPreferencesStore().adopt(preferences.ask)
  if (preferences.app) useAppPreferencesStore().adopt(preferences.app)
}
