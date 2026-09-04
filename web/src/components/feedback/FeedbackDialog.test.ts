import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

const boards = ref([
  { id: 'board_1', name: 'Feature Requests', slug: 'feature-requests', description: null },
  { id: 'board_2', name: 'Feedback', slug: 'feedback', description: null },
])
const submitFeedback = vi.fn()

vi.mock('@/composables/useFeedback', () => ({
  useFeedback: () => ({
    boards,
    available: ref(true),
    loading: ref(false),
    failed: ref(false),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/services/feedback.service', () => ({
  submitFeedback: (...args: unknown[]) => submitFeedback(...args),
}))

vi.mock('@/composables/useExternalLink', () => ({
  useExternalLink: () => ({ openExternalLink: vi.fn() }),
}))

vi.mock('vue-sonner', () => ({ toast: vi.fn() }))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

// ResponsiveDialog renders its body in a named `content` slot; render it inline
// so the form is in the tree without dragging in the overlay machinery.
vi.mock('@/components/responsive/ResponsiveDialog.vue', () => ({
  default: defineComponent({
    props: { open: Boolean, title: String, description: String },
    setup: (_, { slots }) => () => h('div', slots.content?.({ close: () => {} })),
  }),
}))

import FeedbackDialog from './FeedbackDialog.vue'

function boardButtons(w: ReturnType<typeof mount>) {
  return w.findAll('button').filter(b => b.attributes('data-state') !== undefined)
}

async function mountOpen() {
  const w = mount(FeedbackDialog, { props: { open: false } })
  await w.setProps({ open: true })
  await nextTick()
  await nextTick()
  return w
}

describe('FeedbackDialog board selection', () => {
  beforeEach(() => {
    submitFeedback.mockReset()
    submitFeedback.mockResolvedValue({ id: 'post_1', url: null })
  })

  it('preselects the first board', async () => {
    const w = await mountOpen()
    expect(boardButtons(w).map(b => b.attributes('data-state'))).toEqual(['on', 'off'])
  })

  it('keeps a board selected when the active one is pressed again', async () => {
    // Regression: a single-select ToggleGroup deselects on re-press, which left
    // no board chosen and the submit button silently disabled.
    const w = await mountOpen()
    await boardButtons(w)[0].trigger('click')
    await nextTick()

    expect(boardButtons(w).map(b => b.attributes('data-state'))).toEqual(['on', 'off'])
  })

  it('still switches between boards', async () => {
    const w = await mountOpen()
    await boardButtons(w)[1].trigger('click')
    await nextTick()

    expect(boardButtons(w).map(b => b.attributes('data-state'))).toEqual(['off', 'on'])
  })

  it('submits against the board that is selected', async () => {
    const w = await mountOpen()
    await boardButtons(w)[1].trigger('click')
    await nextTick()
    await w.find('#feedback-title').setValue('A title')
    await w.find('form').trigger('submit')
    await nextTick()

    expect(submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'board_2', title: 'A title' }),
    )
  })

  it('does not submit without a title', async () => {
    const w = await mountOpen()
    await w.find('form').trigger('submit')
    await nextTick()

    expect(submitFeedback).not.toHaveBeenCalled()
  })
})
