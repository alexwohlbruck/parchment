import type enUS from './locales/en-US.json'

export const LANGUAGES = ['en-US', 'es-ES', 'en', 'es'] as const

export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'en-US'

/**
 * Dotted leaf paths of the en-US resource tree, e.g. `errors.auth.unauthorized`.
 *
 * en-US is the source of truth: a key that only exists in another locale is a
 * type error at the call site, and the parity test keeps the other locales
 * aligned with it.
 */
export type TranslationKey = DottedLeaves<typeof enUS>

type DottedLeaves<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? K
        : `${K}.${DottedLeaves<T[K]> & string}`
    }[keyof T & string]

/**
 * The request-scoped translate function. Use where the plugin's handler
 * context isn't available (services, helpers) instead of reaching for `any`.
 */
export type TranslateFn = (
  key: TranslationKey,
  options?: Record<string, unknown>,
) => string
