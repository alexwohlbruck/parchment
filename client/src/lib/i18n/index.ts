import { createI18n } from 'vue-i18n'
import enUS from './en-US.json'

type TranslationsSchema = typeof enUS
type Locale = 'en-US' // | 'es-ES'

export const i18n = createI18n<[TranslationsSchema], Locale>({
  legacy: false,
  // locale: 'en-US',
  // fallbackLocale: 'en-US',
  messages: {
    'en-US': enUS,
  },
})
