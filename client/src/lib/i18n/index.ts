import { createI18n } from 'vue-i18n'
import enUS from './en-US.json'
import esES from './es-ES.json'

type TranslationsSchema = typeof enUS
export type Locale = 'en-US' | 'es-ES'

export const i18n = createI18n<[TranslationsSchema | any], Locale>({
  legacy: false,
  // locale: 'es-ES',
  fallbackLocale: 'en-US',
  messages: {
    'en-US': enUS,
    'es-ES': esES,
  },
})
