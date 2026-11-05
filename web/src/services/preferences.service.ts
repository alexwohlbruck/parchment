import type { Ref } from 'vue'
import { api } from '@/lib/api'
import { storedLocale } from '@/lib/i18n'
import type { Locale } from '@/lib/i18n'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem } from '@/types/map.types'
import type { NavigationPreferences } from '@/lib/preferences/navigation-preferences'

export interface UserPreferences {
  language: string
  unitSystem: string
  navigation: NavigationPreferences
}

const SUPPORTED_LOCALES: Locale[] = ['en-US', 'es-ES']

function toLocale(value: string): Locale {
  if (SUPPORTED_LOCALES.includes(value as Locale)) return value as Locale
  if (value.startsWith('es')) return 'es-ES'
  return 'en-US'
}

function toUnitSystem(value: string): UnitSystem {
  return value === UnitSystem.IMPERIAL ? UnitSystem.IMPERIAL : UnitSystem.METRIC
}

/**
 * Fetch preferences from backend and apply locale and unit system locally.
 * Resolves null when not authenticated or offline, keeping local values.
 */
export async function syncPreferencesFromBackend(): Promise<UserPreferences | null> {
  try {
    const { data } = await api.get<UserPreferences>('/users/me/preferences')
    storedLocale.value = toLocale(data.language)
    const appStore = useAppStore()
    appStore.unitSystem = toUnitSystem(data.unitSystem)
    return data
  } catch {
    return null
  }
}

/** Each section sent replaces the stored one; the rest are kept. */
export async function saveNavigationPreferences(
  navigation: Partial<NavigationPreferences>,
): Promise<void> {
  await api.put('/users/me/preferences', { navigation })
}

/**
 * Update preferences on backend and locally. Call when user changes language or units in settings.
 * Requires authentication; updates local state on success.
 */
export async function updatePreferences(updates: {
  language?: Locale
  unitSystem?: UnitSystem
}): Promise<UserPreferences> {
  const body: { language?: string; unitSystem?: string } = {}
  if (updates.language !== undefined) body.language = updates.language
  if (updates.unitSystem !== undefined) body.unitSystem = updates.unitSystem
  const { data } = await api.put<UserPreferences>('/users/me/preferences', body)
  storedLocale.value = toLocale(data.language)
  const appStore = useAppStore()
  appStore.unitSystem = toUnitSystem(data.unitSystem)
  return data
}

/**
 * Get current preferences from backend. Does not apply to local state.
 */
export async function getPreferences(): Promise<UserPreferences> {
  const { data } = await api.get<UserPreferences>('/users/me/preferences')
  return data
}
