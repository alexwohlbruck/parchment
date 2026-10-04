import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { SOURCE } from '@/lib/constants'
import { useCanReviewPlace } from './useCanReviewPlace'
import {
  deleteOwnReview,
  fetchOwnReview,
  getSavedNickname,
  saveReview,
  type OwnReview,
  type ReviewInput,
} from '@/services/place/mangrove-review.service'
import type { Place } from '@/types/place.types'

/** The signed-in user's Mangrove review of a place, and the means to change it. */
export function useMangroveReview(place: Ref<Partial<Place>>) {
  const authStore = useAuthStore()
  const userId = computed(() => authStore.me?.id ?? null)
  const { subject, canReview } = useCanReviewPlace(place)

  const ownReview = shallowRef<OwnReview | null>(null)
  const savedNickname = ref<string>()
  const loading = ref(false)
  const saving = ref(false)

  async function refresh() {
    ownReview.value = null
    if (!canReview.value) return
    const id = userId.value!
    const sub = subject.value!
    loading.value = true
    try {
      const [review, nickname] = await Promise.all([
        fetchOwnReview(id, sub),
        getSavedNickname(id),
      ])
      if (sub !== subject.value) return
      ownReview.value = review
      savedNickname.value = nickname
    } catch (error) {
      console.error('Failed to load own Mangrove review', error)
    } finally {
      loading.value = false
    }
  }

  watch([subject, canReview], refresh, { immediate: true })

  async function save(input: Omit<ReviewInput, 'osmId'>) {
    saving.value = true
    try {
      await saveReview(
        userId.value!,
        subject.value!,
        { ...input, osmId: place.value.externalIds?.[SOURCE.OSM] },
        ownReview.value,
      )
      await refresh()
    } finally {
      saving.value = false
    }
  }

  async function remove() {
    if (!ownReview.value) return
    saving.value = true
    try {
      await deleteOwnReview(userId.value!, ownReview.value.signature)
      ownReview.value = null
    } finally {
      saving.value = false
    }
  }

  return {
    canReview,
    ownReview,
    savedNickname,
    loading,
    saving,
    save,
    remove,
  }
}
