import {
  ASK_HISTORY_DAYS,
  DEFAULT_ASK_PREFERENCES,
  type AskPreferences,
} from '../../types/ask-preferences.types'

const SWITCHES = ['enabled', 'suggest', 'shareLocation', 'webSearch', 'saveHistory'] as const

/** Stored Ask settings over the defaults, dropping anything no longer valid. */
export function resolveAskPreferences(stored: unknown): AskPreferences {
  const raw = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  const resolved = { ...DEFAULT_ASK_PREFERENCES }
  for (const key of SWITCHES) {
    if (typeof raw[key] === 'boolean') resolved[key] = raw[key]
  }
  const keepDays = ASK_HISTORY_DAYS.find((days) => days === raw.keepDays)
  if (keepDays !== undefined) resolved.keepDays = keepDays
  return resolved
}
