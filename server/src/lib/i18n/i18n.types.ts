export const LANGUAGES = ['en-US', 'es-ES', 'en', 'es'] as const

export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'en-US'
