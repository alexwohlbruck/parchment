import { api } from '@/lib/api'
import { toast } from '@/lib/toast'
import { i18n } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth.store'
import { useCollectionGroupsStore } from '@/stores/library/collection-groups.store'
import type { CollectionOrganization } from '@/types/collection-groups.types'

export function useCollectionGroupsService() {
  const store = useCollectionGroupsStore()
  const authStore = useAuthStore()
  const t = (i18n.global as unknown as { t: (key: string) => string }).t

  async function fetchOrganization() {
    const userId = authStore.me?.id
    if (!userId) return false
    const requestRevision = store.organization.revision
    try {
      const { data } = await api.get<CollectionOrganization>(
        '/library/collection-organization/',
      )
      if (
        authStore.me?.id === userId &&
        store.organization.revision > requestRevision &&
        store.organization.revision > data.revision
      )
        return true
      store.setOrganization(userId, data)
      if (authStore.me?.id === userId) {
        store.readyUserId = userId
        return true
      }
      return false
    } catch (error) {
      if (authStore.me?.id === userId) {
        store.readyUserId = null
        toast.error(t('library.collections.groups.loadError'), { cause: error })
      }
      return false
    }
  }

  async function saveOrganization(value: CollectionOrganization) {
    const userId = authStore.me?.id
    if (!userId || !store.editable) return false
    store.saving = true
    try {
      const { data } = await api.put<CollectionOrganization>(
        '/library/collection-organization/',
        value,
      )
      store.setOrganization(userId, data)
      return true
    } catch (error) {
      if (authStore.me?.id !== userId) return false
      if (
        (error as { response?: { status: number } }).response?.status === 409
      ) {
        if (await fetchOrganization()) {
          toast.error(t('library.collections.groups.conflict'))
        }
      } else {
        toast.error(t('library.collections.groups.saveError'))
      }
      return false
    } finally {
      store.saving = false
    }
  }

  async function placeCollection(collectionId: string, groupId: string | null) {
    return saveOrganization({
      ...store.organization,
      placements: [
        ...store.organization.placements.filter(
          placement => placement.collectionId !== collectionId,
        ),
        ...(groupId === null ? [] : [{ collectionId, groupId }]),
      ],
    })
  }

  async function updateGroup(
    id: string,
    updates: { name?: string; parentId?: string | null },
  ) {
    if (!store.organization.groups.some(group => group.id === id)) return false
    return saveOrganization({
      ...store.organization,
      groups: store.organization.groups.map(group =>
        group.id === id ? { ...group, ...updates } : group,
      ),
    })
  }

  return { fetchOrganization, saveOrganization, placeCollection, updateGroup }
}
