import type { SpeechCatalog, SpeechVoice } from '../../types/speech.types'

/** Kokoro voice ids: language letter, gender letter, then the name, e.g. `af_heart`. */
const KOKORO_ID = /^[a-z]([fm])_(.+)$/
const LEGACY_PREFIX = 'v0'
const SUFFIXES = /[_ ]inno$/

const titleCase = (words: string) =>
  words.replace(/[_ ]+/g, ' ').trim().replace(/\b\p{L}/gu, letter => letter.toUpperCase())

function describe(voice: SpeechVoice): (SpeechVoice & { legacy: boolean; key: string }) | null {
  const match = KOKORO_ID.exec(voice.id)
  if (!match) return { ...voice, legacy: false, key: voice.name.toLowerCase() }
  const [, gender, raw] = match
  const legacy = raw.startsWith(LEGACY_PREFIX)
  const base = (legacy ? raw.slice(LEGACY_PREFIX.length) : raw).replace(SUFFIXES, '')
  if (!base) return null
  return {
    ...voice,
    name: titleCase(base),
    gender: gender === 'f' ? 'female' : 'male',
    legacy,
    key: `${voice.language}|${gender}|${base.toLowerCase()}`,
  }
}

/** Readable voice names and genders; legacy copies of a current voice are dropped. */
export function presentCatalog(catalog: SpeechCatalog): SpeechCatalog {
  const described = catalog.voices.map(describe).filter(voice => voice !== null)
  const current = new Set(described.filter(voice => !voice.legacy).map(voice => voice.key))
  const voices = described
    .filter(voice => !voice.legacy || !current.has(voice.key))
    .map(({ legacy: _legacy, key: _key, ...voice }) => voice)
  return { ...catalog, voices }
}
