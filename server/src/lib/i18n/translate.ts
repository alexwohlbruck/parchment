import i18next from 'i18next'
import { getI18nInitOptions, detectLanguage } from './index'
import type { Language, TranslateFn } from './i18n.types'

/**
 * i18next is initialized once and shared by every caller. Kicked off at import
 * so synchronous callers find a populated resource store.
 *
 * This module deliberately has no Elysia dependency — plain library code
 * (place adapters, preset labels, the mailer) translates through here, and only
 * `./plugin` adapts it to a request context.
 */
export const initialization = i18next.init(getI18nInitOptions())

/** A translate function bound to `language`. */
export function translate(language: Language): TranslateFn {
  return i18next.getFixedT(language) as unknown as TranslateFn
}

/** The language a raw request asks for: `?lang` first, then `Accept-Language`. */
export function languageFor(request: Request): Language {
  const url = new URL(request.url)
  return detectLanguage(
    url.searchParams.get('lang') ?? undefined,
    request.headers.get('accept-language') ?? undefined,
  )
}

/** Translate for a raw request — for `onError` and other places outside a
 * handler, where the plugin's derived context isn't available. */
export function translatorFor(request: Request): TranslateFn {
  return translate(languageFor(request))
}
