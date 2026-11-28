import type { NavigationPreferences } from '@/lib/preferences/navigation-preferences'
import type { AskPreferences } from '@/types/ask.types'
import type { AppPreferences } from '@server/types/app-preferences.types'

export interface UserPreferences {
  language: string
  unitSystem: string
  navigation: NavigationPreferences
  ask: AskPreferences
  app: AppPreferences
}
