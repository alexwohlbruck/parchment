import { createI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { watch } from 'vue'
import enUS from './en-US.json'
import esES from './es-ES.json'

type TranslationsSchema = typeof enUS
export type Locale = 'en-US' | 'es-ES'

// Get browser default locale
const getBrowserLocale = (): Locale => {
  const browserLang = navigator.language
  if (browserLang.startsWith('es')) {
    return 'es-ES'
  }
  return 'en-US'
}

// Create reactive storage for locale
export const storedLocale = useStorage<Locale>('locale', getBrowserLocale())

export const i18n = createI18n<[TranslationsSchema | any], Locale>({
  legacy: false,
  locale: storedLocale.value,
  fallbackLocale: 'en-US',
  messages: {
    'en-US': enUS,
    'es-ES': esES,
  },
})

// Sync i18n locale with stored locale
watch(storedLocale, (newLocale) => {
  i18n.global.locale.value = newLocale
})

// Sync stored locale with i18n locale changes
watch(() => i18n.global.locale.value, (newLocale) => {
  if (storedLocale.value !== newLocale) {
    storedLocale.value = newLocale
  }
})
