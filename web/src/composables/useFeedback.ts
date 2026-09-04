import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import {
  fetchFeedbackBoards,
  type FeedbackBoard,
} from '@/services/feedback.service'

/**
 * Feedback is optional per server — it needs the Quackback system integration
 * configured. One probe on first use tells the navigation whether to show the
 * entry points at all, and doubles as the board prefetch for the dialog.
 */
function feedback() {
  const boards = ref<FeedbackBoard[]>([])
  const available = ref(false)
  const loading = ref(false)
  const failed = ref(false)
  let probe: Promise<void> | null = null

  async function load() {
    loading.value = true
    failed.value = false
    try {
      boards.value = await fetchFeedbackBoards()
      available.value = boards.value.length > 0
    } catch {
      available.value = false
      failed.value = true
    } finally {
      loading.value = false
    }
  }

  /** Probe once per session; `refresh` forces a re-fetch. */
  function ensureLoaded(refresh = false) {
    if (refresh) probe = null
    probe ??= load()
    return probe
  }

  return { boards, available, loading, failed, ensureLoaded }
}

export const useFeedback = createSharedComposable(feedback)
