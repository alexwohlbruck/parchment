import { Elysia } from 'elysia'
import { initialization, translate, languageFor, translatorFor } from './translate'
import type { Language, TranslateFn } from './i18n.types'

export { translate, translatorFor }

/**
 * Request-scoped translation. Controllers `.use(i18nPlugin)` to get a
 * key-checked `t` and the resolved `language` in their handler context;
 * Elysia dedupes by plugin name, so this registers once however many
 * controllers ask for it.
 *
 * This replaces the `elysia-i18next` plugin, whose types are built against an
 * older Elysia generic signature — using it collapsed the whole handler context
 * to `any`, which is what forced the `t: any` casts this plugin removes.
 * `getFixedT` binds a language per request without cloning the instance or
 * mutating global state, so concurrent requests in different languages can't
 * race each other.
 *
 * WHERE TO PUT `.use(i18nPlugin)`: on the instance declaration is fine, unless
 * the controller registers public routes *before* an in-place `.use(requireAuth)`
 * / `.use(permissions(...))` on that same instance. Adding a plugin there makes
 * the later guard cover those earlier routes too, turning a public endpoint into
 * a 401 (see the same hazard documented in auth.controller). In those
 * controllers — avatar, notes — chain it onto the guard instead:
 * `app.use(i18nPlugin).use(requireAuth).post(...)`.
 */
export const i18nPlugin = new Elysia({ name: 'parchment-i18n' }).derive(
  { as: 'global' },
  async ({ request }): Promise<{ t: TranslateFn; language: Language }> => {
    await initialization
    const language = languageFor(request)
    return { t: translate(language), language }
  },
)
