// Spoken guidance over the Web Speech API. iOS only lets a page speak after a
// user gesture, so `unlockVoice` runs from the Start tap.

let voices: SpeechSynthesisVoice[] = []

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
}

function loadVoices() {
  voices = synth()?.getVoices() ?? []
}

function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const base = lang.split('-')[0]
  return (
    voices.find(v => v.lang === lang && v.localService) ??
    voices.find(v => v.lang === lang) ??
    voices.find(v => v.lang.startsWith(base))
  )
}

export function unlockVoice(): void {
  const speech = synth()
  if (!speech) return
  loadVoices()
  speech.addEventListener('voiceschanged', loadVoices)
  const silent = new SpeechSynthesisUtterance(' ')
  silent.volume = 0
  speech.speak(silent)
}

/** Urgent prompts cut off whatever is being said; others queue behind it. */
export function speak(text: string, { lang, urgent = false }: { lang: string; urgent?: boolean }): void {
  const speech = synth()
  if (!speech || !text) return
  if (urgent) speech.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  const voice = voiceFor(lang)
  if (voice) utterance.voice = voice
  speech.speak(utterance)
}

export function stopVoice(): void {
  const speech = synth()
  if (!speech) return
  speech.cancel()
  speech.removeEventListener('voiceschanged', loadVoices)
}
