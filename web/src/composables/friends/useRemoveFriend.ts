import { useI18n } from 'vue-i18n'
import { useAppService } from '@/services/app.service'
import { useFriendsStore } from '@/stores/friends.store'
import type { Friendship } from '@/services/friends.service'

/** Confirm, then remove a friend. Resolves true once they are removed. */
export function useRemoveFriend() {
  const { t } = useI18n()
  const appService = useAppService()
  const friendsStore = useFriendsStore()

  async function removeFriend(friend: Friendship): Promise<boolean> {
    const confirmed = await appService.confirm({
      title: t('friends.detail.removeTitle', {
        name: friend.friendName || friend.friendHandle.split('@')[0],
      }),
      description: t('friends.detail.removeConfirmation'),
      continueText: t('general.remove'),
      cancelText: t('general.cancel'),
      destructive: true,
    })
    if (!confirmed) return false
    const { success } = await friendsStore.remove(friend)
    return success
  }

  return { removeFriend }
}
