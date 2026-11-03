import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

const boards = ref([
  {
    id: 'board_1',
    name: 'Feature Requests',
    slug: 'feature-requests',
    description: null,
  },
  { id: 'board_2', name: 'Feedback', slug: 'feedback', description: null },
])
const submitFeedback = vi.fn()
const createFeedbackPortalLogin = vi.fn()
const portalLoginEnabled = ref(false)
const errorToast = vi.fn()
const toast = vi.fn()
const openExternalLink = vi.fn()

const environment = vi.hoisted(() => ({ isTauri: false }))
vi.mock('@/lib/api', () => ({
  get isTauri() {
    return environment.isTauri
  },
}))
vi.mock('@/lib/toast', () => ({
  toast: Object.assign((...args: unknown[]) => toast(...args), {
    error: (...args: unknown[]) => errorToast(...args),
  }),
}))

vi.mock('@/composables/integrations/useFeedback', () => ({
  useFeedback: () => ({
    boards,
    portalLoginEnabled,
    available: ref(true),
    loading: ref(false),
    failed: ref(false),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/services/feedback.service', () => ({
  submitFeedback: (...args: unknown[]) => submitFeedback(...args),
  createFeedbackPortalLogin: (...args: unknown[]) =>
    createFeedbackPortalLogin(...args),
}))

vi.mock('@/composables/useExternalLink', () => ({
  useExternalLink: () => ({
    openExternalLink: (...args: unknown[]) => openExternalLink(...args),
  }),
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
    setup:
      (_, { slots }) =>
      () =>
        h('div', slots.content?.({ close: () => {} })),
  }),
}))

import FeedbackDialog from './FeedbackDialog.vue'

function boardButtons(w: ReturnType<typeof mount>) {
  return w
    .findAll('button')
    .filter(b => b.attributes('data-state') !== undefined)
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
    portalLoginEnabled.value = false
    createFeedbackPortalLogin.mockReset()
    toast.mockClear()
    errorToast.mockClear()
    submitFeedback.mockReset()
    submitFeedback.mockResolvedValue({ id: 'post_1', url: null })
  })

  it('preselects the first board', async () => {
    const w = await mountOpen()
    expect(boardButtons(w).map(b => b.attributes('data-state'))).toEqual([
      'on',
      'off',
    ])
  })

  it('keeps a board selected when the active one is pressed again', async () => {
    // Regression: a single-select ToggleGroup deselects on re-press, which left
    // no board chosen and the submit button silently disabled.
    const w = await mountOpen()
    await boardButtons(w)[0].trigger('click')
    await nextTick()

    expect(boardButtons(w).map(b => b.attributes('data-state'))).toEqual([
      'on',
      'off',
    ])
  })

  it('still switches between boards', async () => {
    const w = await mountOpen()
    await boardButtons(w)[1].trigger('click')
    await nextTick()

    expect(boardButtons(w).map(b => b.attributes('data-state'))).toEqual([
      'off',
      'on',
    ])
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

describe('FeedbackDialog portal login', () => {
  beforeEach(() => {
    environment.isTauri = false
    openExternalLink.mockClear()
    portalLoginEnabled.value = true
    createFeedbackPortalLogin.mockReset()
    createFeedbackPortalLogin.mockResolvedValue({
      url: 'https://feedback.example.com/auth/widget-handoff?ott=once',
    })
    toast.mockClear()
    errorToast.mockClear()
  })

  it('hides portal login when the server has not enabled it', async () => {
    portalLoginEnabled.value = false
    const w = await mountOpen()
    expect(w.text()).not.toContain('feedback.openBoard')
  })

  it('opens the system browser on native apps without creating a web tab', async () => {
    environment.isTauri = true
    const open = vi.spyOn(window, 'open')
    const w = await mountOpen()
    await w
      .findAll('button')
      .find(b => b.text() === 'feedback.openBoard')!
      .trigger('click')
    await nextTick()
    expect(open).not.toHaveBeenCalled()
    expect(openExternalLink).toHaveBeenCalledWith(
      'https://feedback.example.com/auth/widget-handoff?ott=once',
    )
    open.mockRestore()
  })

  it('reserves a tab during the click and navigates it after signing in', async () => {
    const tab = {
      opener: window,
      closed: false,
      location: { replace: vi.fn() },
      close: vi.fn(),
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as any)
    const w = await mountOpen()
    await w
      .findAll('button')
      .find(b => b.text() === 'feedback.openBoard')!
      .trigger('click')
    await nextTick()
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(tab.opener).toBeNull()
    expect(createFeedbackPortalLogin).toHaveBeenCalledWith(undefined)
    expect(tab.location.replace).toHaveBeenCalledWith(
      'https://feedback.example.com/auth/widget-handoff?ott=once',
    )
    open.mockRestore()
  })

  it('closes the reserved tab and reports a failed handoff', async () => {
    const tab = {
      opener: window,
      closed: false,
      location: { replace: vi.fn() },
      close: vi.fn(),
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as any)
    createFeedbackPortalLogin.mockRejectedValue(new Error('upstream offline'))
    const w = await mountOpen()
    await w
      .findAll('button')
      .find(b => b.text() === 'feedback.openBoard')!
      .trigger('click')
    await nextTick()
    expect(tab.close).toHaveBeenCalled()
    expect(tab.location.replace).not.toHaveBeenCalled()
    expect(errorToast).toHaveBeenCalledWith(
      'feedback.portalFailed',
      expect.any(Object),
    )
    open.mockRestore()
  })

  it('does not mint a login when the browser blocks the new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const w = await mountOpen()
    await w
      .findAll('button')
      .find(b => b.text() === 'feedback.openBoard')!
      .trigger('click')
    expect(createFeedbackPortalLogin).not.toHaveBeenCalled()
    expect(errorToast).toHaveBeenCalledWith('feedback.popupBlocked')
    open.mockRestore()
  })

  it('signs in again when viewing a newly submitted post', async () => {
    const tab = {
      opener: window,
      closed: false,
      location: { replace: vi.fn() },
      close: vi.fn(),
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as any)
    submitFeedback.mockResolvedValue({
      id: 'post_5',
      url: 'https://feedback.example.com/b/ideas/posts/post_5',
    })
    const w = await mountOpen()
    await w.find('#feedback-title').setValue('Idea')
    await w.find('form').trigger('submit')
    await nextTick()
    toast.mock.calls[0]![1].action.onClick()
    await nextTick()
    expect(createFeedbackPortalLogin).toHaveBeenCalledWith(
      'https://feedback.example.com/b/ideas/posts/post_5',
    )
    open.mockRestore()
  })
})
