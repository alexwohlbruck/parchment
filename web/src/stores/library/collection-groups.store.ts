import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { isOffline } from '@/lib/connectivity'
import { useAuthStore } from '@/stores/auth.store'
import type { CollectionOrganization } from '@/types/collection-groups.types'

export const useCollectionGroupsStore = defineStore('collection-groups', () => {
  const authStore = useAuthStore()
  const cache = useStorage<Record<string, CollectionOrganization>>(
    'collection-groups',
    {},
  )
  const readyUserId = ref<string | null>(null)
  const saving = ref(false)
  const organization = computed<CollectionOrganization>(() => {
    const id = authStore.me?.id
    return (
      (id && cache.value[id]) || { groups: [], placements: [], revision: 0 }
    )
  })
  const collectionGroupIds = computed(() => {
    const ids = new Set(organization.value.groups.map(group => group.id))
    return new Map(
      organization.value.placements
        .filter(placement => ids.has(placement.groupId))
        .map(placement => [placement.collectionId, placement.groupId]),
    )
  })
  const ready = computed(
    () => !!authStore.me?.id && readyUserId.value === authStore.me.id,
  )

  const editable = computed(
    () => ready.value && !saving.value && !isOffline.value,
  )

  function setOrganization(userId: string, value: CollectionOrganization) {
    cache.value = { ...cache.value, [userId]: value }
  }

  return {
    organization,
    collectionGroupIds,
    ready,
    editable,
    readyUserId,
    saving,
    setOrganization,
  }
})
