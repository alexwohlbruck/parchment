import { api } from '@/lib/api'
import { SpeechPlayer, type SpeechOptions } from './speech-player.service'
import type { SpeechCatalog } from '@server/types/speech.types'

let context: AudioContext | null = null
let voices: SpeechSynthesisVoice[] = []

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

async function resumeAudio(audioContext: AudioContext, signal: AbortSignal): Promise<void> {
  if (audioContext.state === 'running' || signal.aborted) return
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel: (() => void) | undefined
  try {
    await Promise.race([
      audioContext.resume(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Audio activation timed out')), 1000)
        cancel = () => reject(new Error('Speech cancelled'))
        signal.addEventListener('abort', cancel, { once: true })
      }),
    ])
  } finally {
    clearTimeout(timer)
    if (cancel) signal.removeEventListener('abort', cancel)
  }
}

async function playAudio(audio: Blob, signal: AbortSignal): Promise<void> {
  const audioContext = context
  if (!audioContext) throw new Error('Audio is not unlocked')
  await resumeAudio(audioContext, signal)
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
    const { data } = await api.post<Blob>('/speech', {
      text, language: options.lang, voice: options.voice || undefined, rate: options.rate ?? 1,
    }, { signal, responseType: 'blob', silent: true, timeout: 3000 })
    if (!data.type.startsWith('audio/')) throw new Error('Invalid speech audio')
    return data
  },
  playAudio,
  playBrowser,
  onFallback: (error, options) => {
    console.warn('[Speech] Browser fallback', {
      reason: error instanceof Error ? error.message : 'Speech unavailable',
      urgent: !!options.urgent,
    })
  },
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
    void context.resume().catch(() => {})
  }
}

export function speak(text: string, options: SpeechOptions): void { player.speak(text, options) }

export function stopSpeech(): void { player.stop(); browserSpeech()?.cancel() }

export function releaseSpeech(): void {
  stopSpeech()
  browserSpeech()?.removeEventListener('voiceschanged', loadVoices)
  const previous = context
  context = null
  void previous?.close().catch(() => {})
}
