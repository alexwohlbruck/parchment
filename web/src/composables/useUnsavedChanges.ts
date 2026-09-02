/**
 * Guards a route that holds an unsaved draft.
 *
 * Editors live in the map's sheet, which is closed by the browser back button,
 * the sheet's own X, and Esc — three different exits, none of which knows
 * about a half-written layer. Rather than teach each one, this hooks the
 * router: any navigation away from the guarded route stops, asks, and only
 * then proceeds. `beforeunload` covers a tab close on top.
 */

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppService } from '@/services/app.service'

export function useUnsavedChanges(isDirty: Ref<boolean>) {
  const { t } = useI18n()
  const appService = useAppService()

  /** Set while saving, so the post-save redirect isn't itself challenged. */
  const bypass = ref(false)

  function warnOnUnload(event: BeforeUnloadEvent) {
    if (!isDirty.value || bypass.value) return
    event.preventDefault()
    // Chrome ignores custom text but still requires the assignment.
    event.returnValue = ''
  }

  onMounted(() => window.addEventListener('beforeunload', warnOnUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', warnOnUnload))

  onBeforeRouteLeave(async () => {
    if (!isDirty.value || bypass.value) return true
    return await appService.confirm({
      title: t('general.unsavedChanges.title'),
      description: t('general.unsavedChanges.description'),
      continueText: t('general.unsavedChanges.discard'),
      cancelText: t('general.unsavedChanges.keepEditing'),
      destructive: true,
    })
  })

  /** Call before navigating away yourself (after a successful save). */
  function allowLeave() {
    bypass.value = true
  }

  return { allowLeave }
}
