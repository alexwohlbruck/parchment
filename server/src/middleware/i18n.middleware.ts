import { Elysia } from 'elysia'
import { detectLanguage, type SupportedLanguage } from '../lib/i18n'

declare module 'elysia' {
  interface Context {
    language: SupportedLanguage
  }
}

export const i18nMiddleware = new Elysia({ name: 'i18n' }).derive(
  ({ query, headers }) => {
    const queryLang = (query as any)?.lang as string | undefined
    const acceptLanguage = headers['accept-language']
    const language = detectLanguage(queryLang, acceptLanguage)
    return { language }
  },
)

export default i18nMiddleware
