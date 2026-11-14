import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppService } from '@/services/app.service'
import { useCollectionsService } from '@/services/library/collections.service'
import { useIdentityStore } from '@/stores/identity.store'
import type { Collection, CollectionScheme } from '@/types/library.types'

/** Confirm, then move a collection to the other scheme. */
export function useCollectionPrivacy() {
  const { t } = useI18n()
  const appService = useAppService()
  const collectionsService = useCollectionsService()
  const identityStore = useIdentityStore()

  const switching = ref(false)
  const hasIdentity = computed(() => identityStore.isSetupComplete)

  /** Resolves to the switched collection, or null if cancelled or failed. */
  async function switchPrivacy(
    collection: Collection,
    target: CollectionScheme,
  ): Promise<Collection | null> {
    if (switching.value) return null
    const confirmed = await appService.confirm({
      title: t(`library.privacy.confirm.collection.${target}.title`),
      description: t(`library.privacy.confirm.collection.${target}.description`),
      continueText: t(`library.privacy.switchTo.${target}`),
      destructive: target === 'server-key',
    })
    if (!confirmed) return null

    switching.value = true
    try {
      return await appService.toast.promise(
        collectionsService.changeScheme(collection, target),
        {
          loading: t('library.privacy.switching'),
          success: t('library.privacy.switched'),
          error: t('library.privacy.switchFailed'),
        },
      )
    } catch (err) {
      console.error('[collections] privacy switch failed', err)
      return null
    } finally {
      switching.value = false
    }
  }

  return { switchPrivacy, switching, hasIdentity }
}
