import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { shallowRef } from 'vue'
import { writeFileSync } from 'node:fs'
import SpeechSettings from './SpeechSettings.vue'
import { useSpeechStore } from '@/stores/speech.store'
import type { SpeechCatalog } from '@server/types/speech.types'
import english from '@/lib/i18n/en-US.json'

const mocks = vi.hoisted(() => ({ speak: vi.fn(), stopSpeech: vi.fn(), unlockSpeech: vi.fn() }))
vi.mock('@/services/speech/speech.service', () => mocks)
vi.mock('@/components/ui/kbd/Kbd.vue', () => ({ default: { template: '<kbd />' } }))
const catalog = shallowRef<SpeechCatalog | null>(null)
vi.mock('@/composables/speech/useSpeechCatalog', () => ({ useSpeechCatalog: () => ({ catalog }) }))
vi.mock('@/lib/i18n', () => ({ storedLocale: { value: 'en-US' }, i18n: { global: { t: (key: string) => key === 'guidance.settings.speechSample' ? 'In 200 feet, turn right, then keep left.' : key } } }))
const translate = (key: string) => key.split('.').reduce((value: any, part) => value?.[part], english) ?? key
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); catalog.value = null; vi.clearAllMocks() })
afterEach(() => wrapper?.unmount())
const render = () => mount(SpeechSettings, { global: { mocks: { $t: translate } } })

describe('speech settings', () => {
  it('explains browser fallback when no server voices are available', () => {
    wrapper = render()
    expect(wrapper.text()).toContain('Browser voice is used')
    expect(wrapper.findAll('[role="combobox"]')).toHaveLength(1)
  })
  it('offers server voices for the app language and previews the selected rate', async () => {
    catalog.value = { model: 'kokoro:v1.0', voices: [{ id: 'af_heart', name: 'Heart', language: 'en-US' }, { id: 'ef_dora', name: 'Dora', language: 'es' }], rate: { min: .75, max: 1.5, default: 1, native: true }, inflection: false }
    useSpeechStore().preferences = { rate: 1.25, voices: { 'en-US': 'af_heart' } }
    wrapper = render()
    expect(wrapper.findAll('[role="combobox"]')).toHaveLength(2)
    await wrapper.find('button:not([role="combobox"])').trigger('click')
    expect(mocks.unlockSpeech).toHaveBeenCalledOnce()
    expect(mocks.speak).toHaveBeenCalledWith('In 200 feet, turn right, then keep left.', expect.objectContaining({ lang: 'en-US', voice: 'af_heart', rate: 1.25, urgent: true }))
    if (process.env.SPEECH_PREVIEW_HTML) writeFileSync(process.env.SPEECH_PREVIEW_HTML, wrapper.html())
  })
})
