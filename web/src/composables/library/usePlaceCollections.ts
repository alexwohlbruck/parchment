import { computed, onMounted, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useEncryptedPointsStore } from '@/stores/library/encrypted-points.store'
import { isSamePlace, type ExternalIds } from '@/lib/library/external-ids'
import type { DecryptedPoint } from '@/types/library.types'

interface SavedPlaceRef {
  externalIds?: ExternalIds
  /** Shareable collections holding the place, as the server reports them. */
  collectionIds?: string[]
}

/**
 * Every collection a place is in. Shareable memberships come from the server;
 * private ones only exist as encrypted points, so they're found by decrypting.
 */
export function usePlaceCollections(
  place: MaybeRefOrGetter<SavedPlaceRef | null | undefined>,
) {
  const collectionsService = useCollectionsService()
  const collectionsStore = useCollectionsStore()
  const pointsStore = useEncryptedPointsStore()

  onMounted(() => void collectionsService.loadPrivatePoints())
  watch(
    () => collectionsStore.collections.length,
    () => void collectionsService.loadPrivatePoints(),
  )

  /** Collection id → this place's point in it. */
  const privatePoints = computed(() => {
    const externalIds = toValue(place)?.externalIds
    const found = new Map<string, DecryptedPoint>()
    if (!externalIds) return found
    for (const [collectionId, points] of Object.entries(pointsStore.pointsByCollection)) {
      const point = points.find(p => isSamePlace(externalIds, p.externalIds))
      if (point) found.set(collectionId, point)
    }
    return found
  })

  const collectionIds = computed(() => [
    ...new Set([...(toValue(place)?.collectionIds ?? []), ...privatePoints.value.keys()]),
  ])

  return { collectionIds, privatePoints }
}
