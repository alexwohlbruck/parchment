import { describe, expect, test } from 'bun:test'
import { presentCatalog } from './voice-catalog'

const catalog = (ids: string[]) => ({
  model: 'kokoro:v1.0',
  voices: ids.map(id => ({ id, name: id.slice(3), language: 'en-US' })),
  rate: { min: 0.75, max: 1.5, default: 1, native: true },
  inflection: false,
})

describe('presentCatalog', () => {
  test('titles Kokoro voices and reads their gender', () => {
    expect(presentCatalog(catalog(['af_heart', 'am_price_inno'])).voices).toEqual([
      { id: 'af_heart', name: 'Heart', language: 'en-US', gender: 'female' },
      { id: 'am_price_inno', name: 'Price', language: 'en-US', gender: 'male' },
    ])
  })

  test('drops legacy copies of a current voice but keeps legacy-only ones', () => {
    const ids = presentCatalog(catalog(['af_bella', 'af_v0bella', 'af_v0irulan', 'af_v0'])).voices.map(v => [v.id, v.name])
    expect(ids).toEqual([['af_bella', 'Bella'], ['af_v0irulan', 'Irulan']])
  })

  test('leaves voices outside the Kokoro scheme alone', () => {
    const voice = { id: 'custom', name: 'Narrator', language: 'en-US' }
    expect(presentCatalog({ ...catalog([]), voices: [voice] }).voices).toEqual([voice])
  })
})
