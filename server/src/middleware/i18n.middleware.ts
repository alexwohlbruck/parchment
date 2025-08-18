import { Elysia } from 'elysia'
import { detectLanguage, type SupportedLanguage } from '../lib/i18n'

export const i18nMiddleware = (app: Elysia) =>
  app.derive(({ query, headers }) => {
    const queryLang = (query as any)?.lang as string | undefined
    const acceptLanguage = headers['accept-language']
    const language = detectLanguage(queryLang, acceptLanguage)
    return { language }
  })

export default i18nMiddleware
