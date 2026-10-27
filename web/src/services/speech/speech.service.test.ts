import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/api', () => ({ api }))
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
let service: typeof import('./speech.service') | undefined
let activate: () => void
let audioContext: { state: string }
const start = vi.fn()
const browserSpeak = vi.fn()

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  browserSpeak.mockImplementation(utterance => queueMicrotask(() => utterance.onend?.()))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  api.post.mockResolvedValue({ data: { type: 'audio/mpeg', arrayBuffer: async () => new ArrayBuffer(1) } })
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [], addEventListener: vi.fn(), removeEventListener: vi.fn(), cancel: vi.fn(), speak: browserSpeak,
  })
  vi.stubGlobal('AudioContext', class {
    state = 'suspended'
    destination = {}
    constructor() { audioContext = this }
    resume() { return new Promise<void>(resolve => { activate = () => { this.state = 'running'; resolve() } }) }
    decodeAudioData() { return Promise.resolve({}) }
    close() { return Promise.resolve() }
    createBufferSource() {
      return {
        buffer: null, onended: null as (() => void) | null, connect() {}, disconnect() {}, stop() {},
        start() { start(); this.onended?.() },
      }
    }
  })
  service = await import('./speech.service')
})
afterEach(() => { service?.releaseSpeech(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('speech audio activation', () => {
  it('waits for first-use activation instead of falling back when audio arrives first', async () => {
    service!.unlockSpeech()
    service!.speak('Turn left', { lang: 'en-US' })
    await flush()
    expect(audioContext.state).toBe('suspended')
    expect(start).not.toHaveBeenCalled()
    expect(browserSpeak).toHaveBeenCalledTimes(1)
    activate()
    await flush()
    expect(start).toHaveBeenCalledOnce()
    expect(browserSpeak).toHaveBeenCalledTimes(1)
  })

  it('does not play stale first-use audio after navigation stops', async () => {
    service!.unlockSpeech()
    service!.speak('Turn left', { lang: 'en-US' })
    await flush()
    service!.releaseSpeech()
    activate()
    await flush()
    expect(start).not.toHaveBeenCalled()
    expect(browserSpeak).toHaveBeenCalledTimes(1)
  })
})


it('resumes an interrupted audio context before the next announcement', async () => {
  service!.unlockSpeech()
  activate()
  service!.speak('First', { lang: 'en-US' })
  await flush()
  expect(start).toHaveBeenCalledOnce()
  audioContext.state = 'suspended'
  service!.speak('Second', { lang: 'en-US' })
  await flush()
  expect(start).toHaveBeenCalledOnce()
  activate()
  await flush()
  expect(start).toHaveBeenCalledTimes(2)
  expect(browserSpeak).toHaveBeenCalledTimes(1)
})

it('tries the selected voice again after one transient request failure', async () => {
  service!.unlockSpeech()
  activate()
  api.post.mockRejectedValueOnce(new Error('Temporary connection failure'))
  service!.speak('First', { lang: 'en-US' })
  await flush()
  expect(browserSpeak).toHaveBeenCalledTimes(2)
  service!.speak('Second', { lang: 'en-US' })
  await flush()
  expect(api.post).toHaveBeenCalledTimes(2)
  expect(start).toHaveBeenCalledOnce()
  expect(browserSpeak).toHaveBeenCalledTimes(2)
})

it('falls back within a bounded time when interrupted audio cannot resume', async () => {
  vi.useFakeTimers()
  service!.unlockSpeech()
  service!.speak('Turn left', { lang: 'en-US' })
  await flush()
  await vi.advanceTimersByTimeAsync(1000)
  expect(browserSpeak).toHaveBeenCalledTimes(2)
  expect(start).not.toHaveBeenCalled()
  expect(console.warn).toHaveBeenCalledWith('[Speech] Browser fallback', expect.objectContaining({ reason: 'Audio activation timed out' }))
})
