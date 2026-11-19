export const APP_PREFERENCE_SECTIONS = ['theme', 'map', 'general', 'layerAppearances'] as const

export type AppPreferenceSection = (typeof APP_PREFERENCE_SECTIONS)[number]

/** Synced look-and-feel settings, each section absent until first saved. The client owns their contents. */
export type AppPreferences = Partial<Record<AppPreferenceSection, Record<string, unknown>>>
