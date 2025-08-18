import i18next from 'i18next'

export const SUPPORTED_LANGUAGES = [
  'en',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'ru',
  'ja',
  'zh',
] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

export const initI18n = async () => {
  await i18next.init({
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    resources: {},
    interpolation: { escapeValue: false },
    detection: {
      lookupHeader: 'accept-language',
      lookupQuerystring: 'lang',
      lookupFromPathIndex: 0,
      caches: false,
    },
  })
}

export function getBestSupportedLanguage(
  acceptLanguageHeader?: string,
): SupportedLanguage {
  if (!acceptLanguageHeader) return DEFAULT_LANGUAGE

  const languages = acceptLanguageHeader
    .split(',')
    .map((lang) => {
      const [code, qValue] = lang.trim().split(';q=')
      const quality = qValue ? parseFloat(qValue) : 1.0
      const langCode = code.split('-')[0].toLowerCase()
      return { code: langCode, quality }
    })
    .sort((a, b) => b.quality - a.quality)

  for (const { code } of languages) {
    if (SUPPORTED_LANGUAGES.includes(code as SupportedLanguage)) {
      return code as SupportedLanguage
    }
  }

  return DEFAULT_LANGUAGE
}

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage)
}

export function detectLanguage(
  queryLang?: string,
  acceptLanguageHeader?: string,
): SupportedLanguage {
  if (queryLang && isSupportedLanguage(queryLang)) {
    return queryLang
  }
  return getBestSupportedLanguage(acceptLanguageHeader)
}
