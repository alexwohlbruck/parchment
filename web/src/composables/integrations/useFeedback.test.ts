import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

const fetchFeedbackBoards = vi.fn()
const isFeedbackActive = ref(false)

vi.mock('@/services/feedback.service', () => ({
  fetchFeedbackBoards: (...args: unknown[]) => fetchFeedbackBoards(...args),
}))

vi.mock('@/stores/integrations.store', () => ({
  useIntegrationsStore: () => ({ isFeedbackActive }),
}))

// createSharedComposable caches across imports, so pull a fresh module per test.
async function freshUseFeedback() {
  vi.resetModules()
  const mod = await import('./useFeedback')
  return mod.useFeedback()
}

const BOARDS = [{ id: 'board_1', name: 'Bugs', slug: 'bugs', description: null }]

describe('useFeedback', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchFeedbackBoards.mockReset()
    fetchFeedbackBoards.mockResolvedValue(BOARDS)
    isFeedbackActive.value = false
  })

  describe('availability', () => {
    it('follows the feedback capability rather than probing', async () => {
      const feedback = await freshUseFeedback()
      expect(feedback.available.value).toBe(false)
      expect(fetchFeedbackBoards).not.toHaveBeenCalled()

      isFeedbackActive.value = true
      expect(feedback.available.value).toBe(true)
    })

    it('reacts when an admin disconnects the provider', async () => {
      isFeedbackActive.value = true
      const feedback = await freshUseFeedback()
      expect(feedback.available.value).toBe(true)

      isFeedbackActive.value = false
      expect(feedback.available.value).toBe(false)
    })
  })

  describe('boards', () => {
    it('loads them on demand', async () => {
      const feedback = await freshUseFeedback()
      await feedback.ensureLoaded()

      expect(feedback.boards.value).toEqual(BOARDS)
      expect(feedback.failed.value).toBe(false)
    })

    it('fetches only once across repeat calls', async () => {
      const feedback = await freshUseFeedback()
      await Promise.all([feedback.ensureLoaded(), feedback.ensureLoaded()])
      await feedback.ensureLoaded()

      expect(fetchFeedbackBoards).toHaveBeenCalledTimes(1)
    })

    it('re-fetches when asked to refresh', async () => {
      const feedback = await freshUseFeedback()
      await feedback.ensureLoaded()
      await feedback.ensureLoaded(true)

      expect(fetchFeedbackBoards).toHaveBeenCalledTimes(2)
    })

    it('flags a failed fetch and leaves no stale boards', async () => {
      const feedback = await freshUseFeedback()
      await feedback.ensureLoaded()

      fetchFeedbackBoards.mockRejectedValue(new Error('502'))
      await feedback.ensureLoaded(true)

      expect(feedback.failed.value).toBe(true)
      expect(feedback.boards.value).toEqual([])
    })
  })
})
