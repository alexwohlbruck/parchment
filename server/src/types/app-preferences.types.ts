export const APP_PREFERENCE_SECTIONS = ['theme', 'map', 'general', 'layerAppearances', 'security'] as const

export type AppPreferenceSection = (typeof APP_PREFERENCE_SECTIONS)[number]

/** Synced app settings, each section absent until first saved. The client owns their contents. */
export type AppPreferences = Partial<Record<AppPreferenceSection, Record<string, unknown>>>
