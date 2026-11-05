import type { SpeechVoice } from '@server/types/speech.types'

export type VoiceGender = NonNullable<SpeechVoice['gender']>

interface VoiceFilter {
  /** Base language, e.g. `en`. */
  language: string
  region: string | null
  gender: VoiceGender | null
}

export const baseLanguage = (tag: string) => tag.split('-')[0].toLowerCase()

/** The region subtag of a voice's language, e.g. `GB` from `en-GB`. */
export function voiceRegion(voice: SpeechVoice): string | null {
  return voice.language.split('-')[1]?.toUpperCase() ?? null
}

export function voiceRegions(voices: readonly SpeechVoice[], language: string): string[] {
  const regions = voices
    .filter(voice => baseLanguage(voice.language) === language)
    .map(voiceRegion)
    .filter((region): region is string => region !== null)
  return [...new Set(regions)]
}

export function voiceGenders(voices: readonly SpeechVoice[], language: string): VoiceGender[] {
  const genders = voices
    .filter(voice => baseLanguage(voice.language) === language)
    .map(voice => voice.gender)
    .filter((gender): gender is VoiceGender => gender !== undefined)
  return [...new Set(genders)].sort()
}

export function filterVoices(voices: readonly SpeechVoice[], filter: VoiceFilter): SpeechVoice[] {
  return voices.filter(
    voice =>
      baseLanguage(voice.language) === filter.language &&
      (filter.region === null || voiceRegion(voice) === filter.region) &&
      (filter.gender === null || voice.gender === filter.gender),
  )
}
