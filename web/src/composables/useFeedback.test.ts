import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchFeedbackBoards = vi.fn()

vi.mock('@/services/feedback.service', () => ({
  fetchFeedbackBoards: (...args: unknown[]) => fetchFeedbackBoards(...args),
}))

// createSharedComposable caches across imports, so pull a fresh module per test.
async function freshUseFeedback() {
  vi.resetModules()
  const mod = await import('./useFeedback')
  return mod.useFeedback()
}

const BOARDS = [
  { id: 'board_1', name: 'Bugs', slug: 'bugs', description: null },
]

describe('useFeedback', () => {
  beforeEach(() => {
    fetchFeedbackBoards.mockReset()
    fetchFeedbackBoards.mockResolvedValue(BOARDS)
  })

  it('marks feedback available once boards load', async () => {
    const feedback = await freshUseFeedback()
    await feedback.ensureLoaded()

    expect(feedback.available.value).toBe(true)
    expect(feedback.boards.value).toEqual(BOARDS)
    expect(feedback.failed.value).toBe(false)
  })

  it('probes only once across repeat calls', async () => {
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

  it('is unavailable when the server has no feedback configured', async () => {
    fetchFeedbackBoards.mockRejectedValue(new Error('503'))
    const feedback = await freshUseFeedback()
    await feedback.ensureLoaded()

    expect(feedback.available.value).toBe(false)
    expect(feedback.failed.value).toBe(true)
  })

  it('is unavailable when the server returns no boards', async () => {
    fetchFeedbackBoards.mockResolvedValue([])
    const feedback = await freshUseFeedback()
    await feedback.ensureLoaded()

    expect(feedback.available.value).toBe(false)
    expect(feedback.failed.value).toBe(false)
  })
})
