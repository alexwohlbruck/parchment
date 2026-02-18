import type { InitOptions } from 'i18next'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { LANGUAGES, DEFAULT_LANGUAGE, type Language } from './i18n.types'

const __dirname = dirname(fileURLToPath(import.meta.url))

export { LANGUAGES, DEFAULT_LANGUAGE, type Language }

function loadLocaleResource(locale: string): Record<string, unknown> {
  const filePath = join(__dirname, 'locales', `${locale}.json`)
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

/** Options for elysia-i18next plugin (single source of config; no direct i18next runtime use). */
export function getI18nInitOptions(): InitOptions {
  const enUS = loadLocaleResource('en-US')
  const esES = loadLocaleResource('es-ES')
  return {
    lng: DEFAULT_LANGUAGE,
    fallbackLng: {
      en: ['en-US'],
      es: ['es-ES'],
      default: ['en-US'],
    },
    supportedLngs: [...LANGUAGES],
    resources: {
      'en-US': { translation: enUS },
      'es-ES': { translation: esES },
      en: { translation: enUS },
      es: { translation: esES },
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
