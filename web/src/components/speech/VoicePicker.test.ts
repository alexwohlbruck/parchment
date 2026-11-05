import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, h, shallowRef } from 'vue'
import en from '@/lib/i18n/en-US.json'
import VoicePicker from './VoicePicker.vue'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import type { SpeechCatalog } from '@server/types/speech.types'

const mocks = vi.hoisted(() => ({ speak: vi.fn(), unlockSpeech: vi.fn() }))
vi.mock('@/services/speech/speech.service', () => mocks)
const catalog = shallowRef<SpeechCatalog | null>(null)
vi.mock('@/composables/speech/useSpeechCatalog', () => ({ useSpeechCatalog: () => ({ catalog }) }))
vi.mock('@/lib/i18n', () => ({
  storedLocale: { value: 'en-US' },
  i18n: { global: { t: () => 'Sample' } },
}))

const ResponsiveDialog = defineComponent({
  setup: (_, { slots }) => () => h('div', slots.content?.()),
})

const render = () =>
  mount(VoicePicker, {
    props: { open: true },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': en } })],
      stubs: { ResponsiveDialog },
    },
  })

const names = (wrapper: ReturnType<typeof render>) =>
  wrapper.findAll('[role="radio"] .font-medium').map(node => node.text())

describe('VoicePicker', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
    catalog.value = {
      model: 'kokoro:v1.0',
      voices: [
        { id: 'af_heart', name: 'Heart', language: 'en-US', gender: 'female' },
        { id: 'bm_george', name: 'George', language: 'en-GB', gender: 'male' },
        { id: 'ef_dora', name: 'Dora', language: 'es', gender: 'female' },
      ],
      rate: { min: 0.75, max: 1.5, default: 1, native: true },
      inflection: false,
    }
  })
  afterEach(() => vi.useRealTimers())

  it('filters the voices for the language by gender', async () => {
    const wrapper = render()
    expect(names(wrapper)).toEqual(['Automatic', 'Heart', 'George'])
    await wrapper.findAll('button').find(b => b.text() === 'Male')!.trigger('click')
    expect(names(wrapper)).toEqual(['Automatic', 'George'])
  })

  it('previews a hovered voice after a pause and saves a clicked one', async () => {
    const wrapper = render()
    const george = wrapper.findAll('[role="radio"]')[2]
    await george.trigger('pointerenter', { pointerType: 'mouse' })
    expect(mocks.speak).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(mocks.speak).toHaveBeenCalledWith('Sample', expect.objectContaining({ lang: 'en-US', voice: 'bm_george' }))

    await george.trigger('click')
    expect(useNavigationPreferencesStore().speech.voices['en-US']).toBe('bm_george')
  })
})
