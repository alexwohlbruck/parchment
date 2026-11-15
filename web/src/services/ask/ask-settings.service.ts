import { useI18n } from 'vue-i18n'
import { saveAskPreferences } from '@/services/preferences.service'
import { useAskService } from '@/services/ask/ask.service'
import { useAppService } from '@/services/app.service'
import { useAskPreferencesStore } from '@/stores/preferences/ask-preferences.store'
import type { AskPreferences } from '@/types/ask.types'

/** Changes Ask settings here and on the account, undoing the change if the account refuses it. */
export function useAskSettingsService() {
  const { t } = useI18n()
  const askPreferences = useAskPreferencesStore()
  const askService = useAskService()
  const { toast } = useAppService()

  async function update(patch: Partial<AskPreferences>) {
    const previous = askPreferences.preferences
    askPreferences.set(patch)
    try {
      askPreferences.adopt(await saveAskPreferences(patch))
      if ('enabled' in patch) await askService.loadAccess({ fresh: true }).catch(() => null)
    } catch {
      askPreferences.adopt(previous)
      toast.error(t('settings.ask.saveFailed'))
    }
  }

  return { update }
}
