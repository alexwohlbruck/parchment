import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechPlayer, type SpeechOptions } from './speech-player.service'

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const options = { lang: 'en-US', rate: 1.25 }
function outputs() {
  return {
    synthesize: vi.fn(async (_text: string, _options: SpeechOptions, _signal: AbortSignal) => new Blob(['audio'])),
    playAudio: vi.fn(async (_audio: Blob, _signal: AbortSignal) => {}),
    playBrowser: vi.fn(async (_text: string, _options: SpeechOptions, _signal: AbortSignal) => {}),
  }
}
afterEach(() => vi.useRealTimers())

describe('speech playback', () => {
  it('plays server audio in order and forwards language, voice and rate', async () => {
    const output = outputs()
    const player = new SpeechPlayer(output)
    player.speak('Turn right', { ...options, voice: 'af_heart' })
    player.speak('Keep left', options)
    await flush()
    expect(output.synthesize.mock.calls.map(call => call[0])).toEqual(['Turn right', 'Keep left'])
    expect(output.synthesize).toHaveBeenCalledWith('Turn right', expect.objectContaining({ rate: 1.25, voice: 'af_heart' }), expect.any(AbortSignal))
    expect(output.playAudio).toHaveBeenCalledTimes(2)
    expect(output.playBrowser).not.toHaveBeenCalled()
  })
  it('falls back once on a deadline and ignores late synthesis', async () => {
    vi.useFakeTimers()
    const output = outputs()
    let complete!: (blob: Blob) => void
    output.synthesize.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    new SpeechPlayer(output).speak('Turn right', { ...options, urgent: true })
    await vi.advanceTimersByTimeAsync(1500)
    expect(output.playBrowser).toHaveBeenCalledTimes(1)
    complete(new Blob(['late']))
    await flush()
    expect(output.playAudio).not.toHaveBeenCalled()
  })
  it('interrupts pending synthesis immediately for an urgent prompt', async () => {
    const output = outputs()
    output.synthesize.mockImplementationOnce(() => new Promise(() => {}))
    const player = new SpeechPlayer(output)
    player.speak('In a mile', options)
    player.speak('Turn now', { ...options, urgent: true })
    await flush()
    expect(output.synthesize.mock.calls.map(call => call[0])).toEqual(['In a mile', 'Turn now'])
    expect(output.playAudio).toHaveBeenCalledTimes(1)
    expect(output.playBrowser).not.toHaveBeenCalled()
  })
  it('stops playback and drops queued prompts on mute or reroute', async () => {
    const output = outputs()
    output.playAudio.mockImplementation((_blob, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true })))
    const player = new SpeechPlayer(output)
    player.speak('First', options)
    player.speak('Second', options)
    await flush()
    player.stop()
    await flush()
    expect(output.synthesize).toHaveBeenCalledTimes(1)
    expect(output.playBrowser).not.toHaveBeenCalled()
  })
  it('drops a prompt that expires while queued', async () => {
    vi.useFakeTimers()
    const output = outputs()
    let complete!: () => void
    output.playAudio.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const player = new SpeechPlayer(output)
    player.speak('First', options)
    player.speak('Expired', { ...options, maxAgeMs: 100 })
    await flush()
    await vi.advanceTimersByTimeAsync(200)
    complete()
    await flush()
    expect(output.synthesize).toHaveBeenCalledTimes(1)
  })
  it('falls back if audio decoding or playback fails', async () => {
    const output = outputs()
    output.playAudio.mockRejectedValue(new Error('Cannot play'))
    new SpeechPlayer(output).speak('Turn left', options)
    await flush()
    expect(output.playBrowser).toHaveBeenCalledWith('Turn left', options, expect.any(AbortSignal))
  })
})


it('abandons expired playback and advances the queue even if the decoder is stuck', async () => {
  vi.useFakeTimers()
  const output = outputs()
  output.playAudio.mockImplementationOnce(() => new Promise(() => {}))
  const player = new SpeechPlayer(output)
  player.speak('Old instruction', { ...options, maxAgeMs: 100 })
  player.speak('Next instruction', options)
  await flush()
  await vi.advanceTimersByTimeAsync(100)
  expect(output.playAudio.mock.calls[0][1].aborted).toBe(true)
  expect(output.synthesize.mock.calls.map(call => call[0])).toEqual(['Old instruction', 'Next instruction'])
  expect(output.playBrowser).not.toHaveBeenCalled()
})

it('interrupts stalled browser playback for an urgent instruction', async () => {
  const output = outputs()
  output.synthesize.mockRejectedValue(new Error('Offline'))
  output.playBrowser.mockImplementationOnce(() => new Promise(() => {}))
  const player = new SpeechPlayer(output)
  player.speak('Continue straight', options)
  await flush()
  player.speak('Turn now', { ...options, urgent: true })
  await flush()
  expect(output.playBrowser.mock.calls[0][2].aborted).toBe(true)
  expect(output.playBrowser.mock.calls.map(call => call[0])).toEqual(['Continue straight', 'Turn now'])
})


it('allows brief network delays for each non-urgent prompt', async () => {
  vi.useFakeTimers()
  const output = outputs()
  output.synthesize.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(new Blob(['audio'])), 2000)))
  const player = new SpeechPlayer(output)
  player.speak('First instruction', options)
  await vi.advanceTimersByTimeAsync(2000)
  expect(output.playAudio).toHaveBeenCalledTimes(1)
  expect(output.playBrowser).not.toHaveBeenCalled()
  player.speak('Later instruction', options)
  await vi.advanceTimersByTimeAsync(2000)
  expect(output.playAudio).toHaveBeenCalledTimes(2)
  expect(output.playBrowser).not.toHaveBeenCalled()
  player.stop()
})

it('does not extend the first prompt beyond its maneuver deadline', async () => {
  vi.useFakeTimers()
  const output = outputs()
  output.synthesize.mockImplementation(() => new Promise(() => {}))
  const player = new SpeechPlayer(output)
  player.speak('Turn soon', { ...options, maxAgeMs: 500 })
  await vi.advanceTimersByTimeAsync(500)
  expect(output.synthesize.mock.calls[0][2].aborted).toBe(true)
  expect(output.playAudio).not.toHaveBeenCalled()
  expect(output.playBrowser).not.toHaveBeenCalled()
})


it('reports the fallback reason without reporting cancelled or expired prompts', async () => {
  const output = { ...outputs(), onFallback: vi.fn() }
  const error = new Error('Provider unavailable')
  output.synthesize.mockRejectedValueOnce(error)
  const player = new SpeechPlayer(output)
  player.speak('Turn left', options)
  await flush()
  expect(output.onFallback).toHaveBeenCalledWith(error, options)
  output.synthesize.mockImplementationOnce(() => new Promise(() => {}))
  player.speak('Cancelled', options)
  player.stop()
  await flush()
  expect(output.onFallback).toHaveBeenCalledTimes(1)
})
