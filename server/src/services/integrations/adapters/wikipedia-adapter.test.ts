/**
 * Unit tests for the Wikipedia adapter.
 *
 * Wikipedia extracts are long-form prose, so the description is truncated at
 * 1000 characters — but on a SENTENCE boundary when one falls late enough,
 * otherwise the card ends mid-word. That heuristic (cut at the last
 * ./!/? past position 700, else append an ellipsis) is the fiddliest part here.
 *
 * The place-type inference is a title-keyword fallback used when the infobox
 * has no type field. It is deliberately coarse; the tests pin the mapping so a
 * reordering doesn't silently reclassify every "Central Park station".
 */

import { describe, test, expect } from 'bun:test'
import { WikipediaAdapter } from './wikipedia-adapter'
import { SOURCE } from '../../../lib/constants'

const adapter = new WikipediaAdapter()

function pageData(over: Partial<any> = {}): any {
  return {
    title: 'Bank of America Stadium',
    extract: 'A stadium in Charlotte, North Carolina.',
    ...over,
  }
}

const adapt = (data: any, title = 'Bank_of_America_Stadium', language = 'en') =>
  adapter.placeInfo.adaptPlaceDetails(data, title, language)

describe('identity', () => {
  test('builds a language-scoped id and external id', () => {
    const place = adapt(pageData())

    expect(place.id).toBe(`${SOURCE.WIKIPEDIA}/en:Bank_of_America_Stadium`)
    expect(place.externalIds[SOURCE.WIKIPEDIA]).toBe('en:Bank_of_America_Stadium')
  })

  test('scopes the id by language so translations do not collide', () => {
    const en = adapt(pageData(), 'Cologne_Cathedral', 'en')
    const de = adapt(pageData(), 'Kölner_Dom', 'de')

    expect(en.id).not.toBe(de.id)
    expect(de.id).toContain('de:')
  })

  test('links back to the language-specific article', () => {
    const place = adapt(pageData(), 'Bank_of_America_Stadium', 'es')

    expect(place.sources[0].url).toBe(
      'https://es.wikipedia.org/wiki/Bank_of_America_Stadium',
    )
    expect(place.sources[0].id).toBe(SOURCE.WIKIPEDIA)
  })

  test('URL-encodes a title with special characters', () => {
    const place = adapt(pageData(), 'Kölner_Dom', 'de')

    expect(place.sources[0].url).toContain('K%C3%B6lner_Dom')
  })
})

describe('name', () => {
  test('prefers the page title from the payload', () => {
    expect(adapt(pageData({ title: 'Real Title' })).name.value).toBe('Real Title')
  })

  test('falls back to the requested title with underscores replaced', () => {
    const place = adapt(pageData({ title: '' }), 'Bank_of_America_Stadium')

    expect(place.name.value).toBe('Bank of America Stadium')
  })
})

describe('description', () => {
  test('carries a short extract through', () => {
    const place = adapt(pageData())

    expect(place.description!.value).toBe('A stadium in Charlotte, North Carolina.')
  })

  test('is null when the page has no extract', () => {
    expect(adapt(pageData({ extract: undefined })).description).toBeNull()
  })

  test('collapses newlines and repeated whitespace', () => {
    const place = adapt(
      pageData({ extract: 'First line.\n\nSecond   line.\t Third.' }),
    )

    expect(place.description!.value).toBe('First line. Second line. Third.')
  })

  test('truncates a long extract at a late sentence boundary', () => {
    // 900 chars of filler, then a sentence end, then more.
    const extract = `${'a'.repeat(890)}. ${'b'.repeat(300)}`

    const place = adapt(pageData({ extract }))

    expect(place.description!.value.length).toBeLessThanOrEqual(1000)
    expect(place.description!.value.endsWith('.')).toBe(true)
    expect(place.description!.value).not.toContain('...')
  })

  test('appends an ellipsis when no sentence ends late enough', () => {
    // A single unbroken 1200-char run has no boundary past position 700.
    const place = adapt(pageData({ extract: 'a'.repeat(1200) }))

    expect(place.description!.value.endsWith('...')).toBe(true)
  })

  test('leaves an extract at exactly the limit untouched', () => {
    const place = adapt(pageData({ extract: 'a'.repeat(1000) }))

    expect(place.description!.value).toHaveLength(1000)
    expect(place.description!.value).not.toContain('...')
  })

  test('recognizes ! and ? as sentence boundaries', () => {
    const extract = `${'a'.repeat(890)}! ${'b'.repeat(300)}`

    const place = adapt(pageData({ extract }))

    expect(place.description!.value.endsWith('!')).toBe(true)
  })
})

describe('place type inference', () => {
  test('prefers an infobox type field', () => {
    const place = adapt(pageData({ infobox: { type: 'Stadium' } }))

    expect(place.placeType.value).toBe('stadium')
  })

  test('falls back through the other infobox fields', () => {
    const place = adapt(pageData({ infobox: { building_type: 'Arena' } }))

    expect(place.placeType.value).toBe('arena')
  })

  const titleCases: Array<[string, string]> = [
    ['St Paul Cathedral', 'church'],
    ['Museum of Modern Art', 'museum'],
    ['Central Park', 'park'],
    ['Botanical Garden', 'park'],
    ['Brooklyn Bridge', 'bridge'],
    ['Windsor Castle', 'historic building'],
    ['Buckingham Palace', 'historic building'],
    ['Times Square', 'square'],
    ['Union Station', 'transportation'],
  ]

  for (const [title, expected] of titleCases) {
    test(`infers "${expected}" from the title "${title}"`, () => {
      expect(adapt(pageData({ title, infobox: undefined })).placeType.value).toBe(
        expected,
      )
    })
  }

  test('falls back to a generic place', () => {
    expect(
      adapt(pageData({ title: 'Some Notable Thing', infobox: undefined }))
        .placeType.value,
    ).toBe('place')
  })

  test('ignores a non-string infobox type', () => {
    const place = adapt(
      pageData({ title: 'Central Park', infobox: { type: 42 } }),
    )

    expect(place.placeType.value).toBe('park')
  })
})

describe('geometry', () => {
  test('maps Wikipedia lat/lon into a centre point', () => {
    const place = adapt(
      pageData({ coordinates: [{ lat: 35.2258, lon: -80.8528 }] }),
    )

    expect(place.geometry.value).toEqual({
      type: 'point',
      center: { lat: 35.2258, lng: -80.8528 },
    })
  })

  test('uses the first coordinate when several are present', () => {
    const place = adapt(
      pageData({
        coordinates: [
          { lat: 1, lon: 2 },
          { lat: 3, lon: 4 },
        ],
      }),
    )

    expect(place.geometry.value.center).toEqual({ lat: 1, lng: 2 })
  })

  test('falls back to null island when the page has no coordinates', () => {
    // Documents current behaviour: an article with no coordinates still
    // produces a geometry, at 0,0.
    const place = adapt(pageData())

    expect(place.geometry.value.center).toEqual({ lat: 0, lng: 0 })
  })
})

describe('photos and contact info', () => {
  test('promotes the page image to a primary photo', () => {
    const place = adapt(
      pageData({
        original: { source: 'https://wiki.test/img.jpg', width: 1200, height: 800 },
      }),
    )

    expect(place.photos).toHaveLength(1)
    expect(place.photos[0].value).toMatchObject({
      url: 'https://wiki.test/img.jpg',
      width: 1200,
      height: 800,
      isPrimary: true,
    })
  })

  test('emits no photos when the page has no image', () => {
    expect(adapt(pageData()).photos).toEqual([])
  })

  test('extracts a website from the infobox', () => {
    const place = adapt(
      pageData({ infobox: { website: 'https://panthers.test' } }),
    )

    expect(place.contactInfo.website.value).toBe('https://panthers.test')
  })

  test('ignores an infobox website that is not a URL', () => {
    const place = adapt(pageData({ infobox: { website: 'see below' } }))

    expect(place.contactInfo.website).toBeNull()
  })

  test('falls through the alternate website field names', () => {
    const place = adapt(
      pageData({ infobox: { official_website: 'https://panthers.test' } }),
    )

    expect(place.contactInfo.website.value).toBe('https://panthers.test')
  })

  test('extracts a phone number from the infobox', () => {
    const place = adapt(pageData({ infobox: { telephone: '+1 704 555 0100' } }))

    expect(place.contactInfo.phone.value).toBe('+1 704 555 0100')
  })

  test('reports empty contact info without an infobox', () => {
    const place = adapt(pageData())

    expect(place.contactInfo).toMatchObject({
      phone: null,
      email: null,
      website: null,
      socials: {},
    })
  })
})

describe('fields Wikipedia does not provide', () => {
  test('reports no structured address', () => {
    expect(adapt(pageData()).address).toBeNull()
  })

  test('reports no opening hours', () => {
    expect(adapt(pageData()).openingHours).toBeNull()
  })
})
