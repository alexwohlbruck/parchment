import { api } from '@/lib/api'
import { storedLocale } from '@/lib/i18n'
import type { Locale } from '@/lib/i18n'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem } from '@/types/map.types'
import type { NavigationPreferences } from '@/lib/preferences/navigation-preferences'
import type { AskPreferences } from '@/types/ask.types'
import type { AppPreferences } from '@server/types/app-preferences.types'
import type { UserPreferences } from '@/types/preferences.types'

export type { UserPreferences }

const SUPPORTED_LOCALES: Locale[] = ['en-US', 'es-ES']

export function toLocale(value: string): Locale {
  if (SUPPORTED_LOCALES.includes(value as Locale)) return value as Locale
  if (value.startsWith('es')) return 'es-ES'
  return 'en-US'
}

export function toUnitSystem(value: string): UnitSystem {
  return value === UnitSystem.IMPERIAL ? UnitSystem.IMPERIAL : UnitSystem.METRIC
}

/** Identifies this tab's saves, so the realtime echo of its own change can be skipped. */
export const PREFERENCES_ORIGIN = crypto.randomUUID()

/** The account's preferences, or null when signed out or offline. */
export async function fetchPreferences(): Promise<UserPreferences | null> {
  try {
    const { data } = await api.get<UserPreferences>('/users/me/preferences')
    return data
  } catch {
    return null
  }
}

function putPreferences(body: Record<string, unknown>) {
  return api.put<UserPreferences>('/users/me/preferences', { ...body, origin: PREFERENCES_ORIGIN })
}

/** Each section sent replaces the stored one; the rest are kept. */
export async function saveNavigationPreferences(
  navigation: Partial<NavigationPreferences>,
): Promise<void> {
  await putPreferences({ navigation })
}

/** Each section sent replaces the stored one; the rest are kept. */
export async function saveAppPreferences(app: AppPreferences): Promise<void> {
  await putPreferences({ app })
}

/** Settings sent are merged into the account's; the rest are kept. */
export async function saveAskPreferences(ask: Partial<AskPreferences>): Promise<AskPreferences> {
  const { data } = await putPreferences({ ask })
  return data.ask
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
  const { data } = await putPreferences(body)
  if (body.language !== undefined) storedLocale.value = toLocale(data.language)
  if (body.unitSystem !== undefined) useAppStore().unitSystem = toUnitSystem(data.unitSystem)
  return data
}
