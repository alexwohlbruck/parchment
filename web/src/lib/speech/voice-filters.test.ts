import { describe, expect, it } from 'vitest'
import { filterVoices, voiceGenders, voiceRegions } from './voice-filters'

const voices = [
  { id: 'af_heart', name: 'Heart', language: 'en-US', gender: 'female' as const },
  { id: 'bm_george', name: 'George', language: 'en-GB', gender: 'male' as const },
  { id: 'bf_emma', name: 'Emma', language: 'en-GB', gender: 'female' as const },
  { id: 'ef_dora', name: 'Dora', language: 'es', gender: 'female' as const },
]

describe('voice filters', () => {
  it('lists the regions and genders a language offers', () => {
    expect(voiceRegions(voices, 'en')).toEqual(['US', 'GB'])
    expect(voiceRegions(voices, 'es')).toEqual([])
    expect(voiceGenders(voices, 'en')).toEqual(['female', 'male'])
  })

  it('narrows by language, region and gender together', () => {
    expect(filterVoices(voices, { language: 'en', region: 'GB', gender: null }).map(v => v.id)).toEqual(['bm_george', 'bf_emma'])
    expect(filterVoices(voices, { language: 'en', region: null, gender: 'female' }).map(v => v.id)).toEqual(['af_heart', 'bf_emma'])
  })
})
