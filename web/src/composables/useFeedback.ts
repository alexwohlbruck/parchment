import { ref, computed } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { useIntegrationsStore } from '@/stores/integrations.store'
import {
  fetchFeedbackBoards,
  type FeedbackBoard,
} from '@/services/feedback.service'

/**
 * Feedback is available when some configured integration offers the feedback
 * capability — no probe needed, the integrations store already knows. Boards
 * are fetched lazily, only once something actually opens the form.
 */
function feedback() {
  const { isFeedbackActive } = storeToRefs(useIntegrationsStore())

  const boards = ref<FeedbackBoard[]>([])
  const loading = ref(false)
  const failed = ref(false)
  let inFlight: Promise<void> | null = null

  const available = computed(() => isFeedbackActive.value)

  async function load() {
    loading.value = true
    failed.value = false
    try {
      boards.value = await fetchFeedbackBoards()
    } catch {
      boards.value = []
      failed.value = true
    } finally {
      loading.value = false
    }
  }

  /** Fetch once; `refresh` forces a re-fetch. */
  function ensureLoaded(refresh = false) {
    if (refresh) inFlight = null
    inFlight ??= load()
    return inFlight
  }

  return { boards, available, loading, failed, ensureLoaded }
}

export const useFeedback = createSharedComposable(feedback)
