/** Days Ask keeps a thread after it was last used; 0 keeps it until deleted. */
export const ASK_HISTORY_DAYS = [1, 7, 30, 90, 365, 0] as const
export type AskHistoryDays = (typeof ASK_HISTORY_DAYS)[number]

export interface AskPreferences {
  /** Off hides Ask everywhere and refuses its endpoints. */
  enabled: boolean
  /** Select Ask first when a search reads like a question. */
  suggest: boolean
  /** Send where you are and your Home and Work, so "from here" and "to work" work. */
  shareLocation: boolean
  webSearch: boolean
  /** Keep threads, end-to-end encrypted, on your account. */
  saveHistory: boolean
  keepDays: AskHistoryDays
}

export const DEFAULT_ASK_PREFERENCES: AskPreferences = {
  enabled: true,
  suggest: true,
  shareLocation: true,
  webSearch: true,
  saveHistory: true,
  keepDays: 30,
}
