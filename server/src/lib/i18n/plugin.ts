import { Elysia } from 'elysia'
import i18next from 'i18next'
import { getI18nInitOptions, detectLanguage } from './index'
import type { Language, TranslateFn } from './i18n.types'

/**
 * i18next is initialized once and shared by every request. Kicked off at import
 * so synchronous callers (`translatorFor`) find a populated resource store.
 */
const initialization = i18next.init(getI18nInitOptions())

/** Resolve the language for a raw request — for `onError` and other places
 * outside a handler, where the plugin's derived context isn't available. */
export function translatorFor(request: Request): TranslateFn {
  const url = new URL(request.url)
  const language = detectLanguage(
    url.searchParams.get('lang') ?? undefined,
    request.headers.get('accept-language') ?? undefined,
  )
  return i18next.getFixedT(language) as unknown as TranslateFn
}

/**
 * Request-scoped translation. Controllers `.use(i18nPlugin)` to get a
 * key-checked `t` and the resolved `language` in their handler context;
 * Elysia dedupes by plugin name, so this registers once however many
 * controllers ask for it.
 *
 * Language comes from `?lang` first, then `Accept-Language`.
 *
 * This replaces the `elysia-i18next` plugin, whose types are built against an
 * older Elysia generic signature — using it collapsed the whole handler context
 * to `any`, which is what forced the `t: any` casts this plugin removes.
 * `getFixedT` binds a language per request without cloning the instance or
 * mutating global state, so concurrent requests in different languages can't
 * race each other.
 */
export const i18nPlugin = new Elysia({ name: 'parchment-i18n' }).derive(
  { as: 'global' },
  async ({ request }): Promise<{ t: TranslateFn; language: Language }> => {
    await initialization
    const url = new URL(request.url)
    const language = detectLanguage(
      url.searchParams.get('lang') ?? undefined,
      request.headers.get('accept-language') ?? undefined,
    )
    return {
      t: i18next.getFixedT(language) as unknown as TranslateFn,
      language,
    }
  },
)
