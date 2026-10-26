import { api } from '@/lib/api'
import { SpeechPlayer, type SpeechOptions } from './speech-player.service'
import type { SpeechCatalog } from '@server/types/speech.types'

let context: AudioContext | null = null
let activation: Promise<void> | null = null
let voices: SpeechSynthesisVoice[] = []
let retryAfter = 0

function browserSpeech() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
}

function loadVoices() { voices = browserSpeech()?.getVoices() ?? [] }

export async function getSpeechCatalog(signal?: AbortSignal): Promise<SpeechCatalog> {
  const { data } = await api.get<SpeechCatalog>('/speech', { signal, timeout: 3000, silent: true })
  if (!Array.isArray(data?.voices) || data.voices.some(voice => typeof voice.id !== 'string' || typeof voice.name !== 'string' || typeof voice.language !== 'string')) throw new Error('Invalid speech catalog')
  return data
}

function playBrowser(text: string, options: SpeechOptions, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const speech = browserSpeech()
    if (!speech || signal.aborted) return resolve()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = options.lang
    utterance.rate = options.rate ?? 1
    const base = options.lang.split('-')[0]
    utterance.voice = voices.find(v => v.lang === options.lang && v.localService)
      ?? voices.find(v => v.lang === options.lang)
      ?? voices.find(v => v.lang.split('-')[0] === base) ?? null
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      utterance.onend = null
      utterance.onerror = null
      resolve()
    }
    const cancel = () => { speech.cancel(); finish() }
    const timer = setTimeout(cancel, 20_000)
    signal.addEventListener('abort', cancel, { once: true })
    utterance.onend = finish
    utterance.onerror = () => { finish(); reject(new Error('Browser speech failed')) }
    speech.speak(utterance)
  })
}

async function playAudio(audio: Blob, signal: AbortSignal): Promise<void> {
  const audioContext = context
  if (!audioContext) throw new Error('Audio is not unlocked')
  await activation
  if (signal.aborted || context !== audioContext) return
  if (audioContext.state !== 'running') throw new Error('Audio is not unlocked')
  const buffer = await audioContext.decodeAudioData(await audio.arrayBuffer())
  if (signal.aborted || context !== audioContext) return
  const source = audioContext.createBufferSource()
  source.buffer = buffer
  source.connect(audioContext.destination)
  await new Promise<void>(resolve => {
    const finish = () => {
      signal.removeEventListener('abort', cancel)
      source.onended = null
      source.disconnect()
      resolve()
    }
    const cancel = () => { source.stop(); finish() }
    signal.addEventListener('abort', cancel, { once: true })
    source.onended = finish
    source.start()
  })
}

const player = new SpeechPlayer({
  synthesize: async (text, options, signal) => {
    if (Date.now() < retryAfter) throw new Error('Speech temporarily unavailable')
    try {
      const { data } = await api.post<Blob>('/speech', {
        text, language: options.lang, voice: options.voice || undefined, rate: options.rate ?? 1,
      }, { signal, responseType: 'blob', silent: true, timeout: 3000 })
      if (!data.type.startsWith('audio/')) throw new Error('Invalid speech audio')
      return data
    } catch (error) {
      if (!signal.aborted) retryAfter = Date.now() + 30_000
      throw error
    }
  },
  playAudio,
  playBrowser,
})

export function unlockSpeech(): void {
  const speech = browserSpeech()
  loadVoices()
  speech?.removeEventListener('voiceschanged', loadVoices)
  speech?.addEventListener('voiceschanged', loadVoices)
  if (speech) {
    const silent = new SpeechSynthesisUtterance(' ')
    silent.volume = 0
    speech.speak(silent)
  }
  if (typeof AudioContext !== 'undefined') {
    context ??= new AudioContext()
    activation = context.resume().catch(() => {})
  }
}

export function speak(text: string, options: SpeechOptions): void { player.speak(text, options) }

export function stopSpeech(): void { player.stop(); browserSpeech()?.cancel() }

export function releaseSpeech(): void {
  stopSpeech()
  browserSpeech()?.removeEventListener('voiceschanged', loadVoices)
  const previous = context
  context = null
  activation = null
  void previous?.close().catch(() => {})
}
