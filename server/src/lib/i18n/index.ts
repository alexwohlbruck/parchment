import type { InitOptions } from 'i18next'
import { LANGUAGES, DEFAULT_LANGUAGE, type Language } from './i18n.types'
import enUS from './locales/en-US.json'
import esES from './locales/es-ES.json'

export { LANGUAGES, DEFAULT_LANGUAGE, type Language }

/** Options for elysia-i18next plugin (single source of config; no direct i18next runtime use). */
export function getI18nInitOptions(): InitOptions {
  const enUSResource = enUS as Record<string, unknown>
  const esESResource = esES as Record<string, unknown>
  return {
    lng: DEFAULT_LANGUAGE,
    fallbackLng: {
      en: ['en-US'],
      es: ['es-ES'],
      default: ['en-US'],
    },
    supportedLngs: [...LANGUAGES],
    resources: {
      'en-US': { translation: enUSResource },
      'es-ES': { translation: esESResource },
      en: { translation: enUSResource },
      es: { translation: esESResource },
    },
    interpolation: { escapeValue: false },
  }
}

export function getBestLanguage(acceptLanguageHeader?: string): Language {
  if (!acceptLanguageHeader) return DEFAULT_LANGUAGE

  const languages = acceptLanguageHeader
    .split(',')
    .map((lang) => {
      const [code, qValue] = lang.trim().split(';q=')
      const quality = qValue ? parseFloat(qValue) : 1.0
      const normalized =
        code.split('-')[0].toLowerCase() === 'en'
          ? 'en-US'
          : code.split('-')[0].toLowerCase() === 'es'
            ? 'es-ES'
            : code.trim()
      return { code: normalized, quality }
    })
    .sort((a, b) => b.quality - a.quality)

  for (const { code } of languages) {
    if (LANGUAGES.includes(code as Language)) {
      return code === 'en'
        ? 'en-US'
        : code === 'es'
          ? 'es-ES'
          : (code as Language)
    }
  }

  return DEFAULT_LANGUAGE
}

export function isValidLanguage(lang: string): boolean {
  const normalized = lang.split('-')[0].toLowerCase()
  return ['en', 'es'].includes(normalized)
}

export function detectLanguage(
  queryLang?: string,
  acceptLanguageHeader?: string,
): Language {
  if (queryLang) {
    const normalized =
      queryLang.split('-')[0].toLowerCase() === 'en'
        ? 'en-US'
        : queryLang.split('-')[0].toLowerCase() === 'es'
          ? 'es-ES'
          : queryLang
    if (isValidLanguage(normalized)) return normalized as Language
  }
  return getBestLanguage(acceptLanguageHeader)
}

/** Two-letter language code for external APIs (e.g. OSM, OpenWeatherMap) */
export function getLanguageCode(lang: string): string {
  const code = lang.split('-')[0].toLowerCase()
  return ['en', 'es'].includes(code) ? code : 'en'
}
