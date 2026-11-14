import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppService } from '@/services/app.service'
import { useFriendsStore } from '@/stores/friends.store'
import { useFriendLocations } from '@/composables/friends/useFriendLocations'

/** Refresh friends' keys, then their locations, behind a loading toast. */
export function useSyncFriendKeys() {
  const { t } = useI18n()
  const appService = useAppService()
  const friendsStore = useFriendsStore()
  const friendLocations = useFriendLocations()
  const isSyncing = ref(false)

  async function syncKeys() {
    if (isSyncing.value) return
    isSyncing.value = true
    await appService.toast.promise(async () => {
      await friendsStore.syncKeys()
      await friendLocations.fetchLocations()
    }, {
      loading: t('friends.detail.syncingKeys'),
      success: t('friends.detail.keysSynced'),
      error: t('friends.detail.syncFailed'),
    }).catch(() => {})
    isSyncing.value = false
  }

  return { isSyncing, syncKeys }
}
