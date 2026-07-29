/**
 * Unit tests for the Wikidata adapter.
 *
 * Wikidata is a claims graph, so everything here is property-code plumbing:
 * P31 "instance of" drives the place type, P625 the coordinates, P18 the
 * images, P856 the official website. A transposed code silently produces a
 * place at 0,0 with no type, which is exactly the failure these pin down.
 *
 * Images are hosted on Commons, not Wikidata, so extracted photos are
 * attributed to WIKIMEDIA even though the claim came from Wikidata — the merge
 * layer prioritizes by source, and mis-attributing would rank them wrongly.
 *
 * Wikidata descriptions are deliberately dropped: they are one-liners like
 * "stadium in North Carolina" that read worse than nothing next to a Wikipedia
 * extract.
 */

import { describe, test, expect, mock } from 'bun:test'
import { SOURCE } from '../../../lib/constants'

mock.module('../../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { WikidataAdapter } = await import('./wikidata-adapter')

const adapter = new WikidataAdapter()

/** Wrap a value in Wikidata's claim envelope. */
const claim = (value: unknown) => ({ mainsnak: { datavalue: { value } } })

function entity(over: Partial<any> = {}): any {
  return {
    labels: { en: { value: 'Bank of America Stadium' } },
    claims: {},
    ...over,
  }
}

const adapt = (e: any, id = 'Q1063714') =>
  adapter.placeInfo.adaptPlaceDetails(e, id)

describe('identity', () => {
  test('builds the id and external id from the QID', () => {
    const place = adapt(entity())

    expect(place.id).toBe(`${SOURCE.WIKIDATA}/Q1063714`)
    expect(place.externalIds[SOURCE.WIKIDATA]).toBe('Q1063714')
  })

  test('links to the Wikidata entity page', () => {
    const place = adapt(entity())

    expect(place.sources[0]).toMatchObject({
      id: SOURCE.WIKIDATA,
      url: 'https://www.wikidata.org/entity/Q1063714',
    })
  })
})

describe('name', () => {
  test('prefers the English label', () => {
    const place = adapt(
      entity({
        labels: { de: { value: 'Deutscher Name' }, en: { value: 'English Name' } },
      }),
    )

    expect(place.name.value).toBe('English Name')
  })

  test('falls back to any available language', () => {
    const place = adapt(entity({ labels: { de: { value: 'Kölner Dom' } } }))

    expect(place.name.value).toBe('Kölner Dom')
  })

  test('is null when the entity has no labels', () => {
    expect(adapt(entity({ labels: undefined })).name.value).toBeNull()
  })
})

describe('place type from P31', () => {
  const withInstanceOf = (qid: string) =>
    adapt(entity({ claims: { P31: [claim({ id: qid })] } })).placeType.value

  const mappings: Array<[string, string]> = [
    ['Q515', 'city'],
    ['Q532', 'village'],
    ['Q3957', 'town'],
    ['Q23413', 'castle'],
    ['Q16970', 'church building'],
    ['Q33506', 'museum'],
    ['Q174782', 'square'],
    ['Q12280', 'bridge'],
    ['Q41176', 'building'],
    ['Q570116', 'tourist attraction'],
  ]

  for (const [qid, expected] of mappings) {
    test(`maps ${qid} to "${expected}"`, () => {
      expect(withInstanceOf(qid)).toBe(expected)
    })
  }

  test('falls back to a generic place for an unmapped type', () => {
    expect(withInstanceOf('Q999999999')).toBe('place')
  })

  test('falls back when the entity has no claims', () => {
    expect(adapt(entity({ claims: undefined })).placeType.value).toBe('place')
  })

  test('falls back when there is no P31 claim', () => {
    expect(adapt(entity({ claims: { P625: [] } })).placeType.value).toBe('place')
  })

  test('uses the first instance-of claim', () => {
    const place = adapt(
      entity({
        claims: { P31: [claim({ id: 'Q33506' }), claim({ id: 'Q515' })] },
      }),
    )

    expect(place.placeType.value).toBe('museum')
  })
})

describe('geometry from P625', () => {
  test('maps latitude and longitude', () => {
    const place = adapt(
      entity({
        claims: { P625: [claim({ latitude: 35.2258, longitude: -80.8528 })] },
      }),
    )

    expect(place.geometry.value).toEqual({
      type: 'point',
      center: { lat: 35.2258, lng: -80.8528 },
    })
  })

  test('falls back to 0,0 with no claims at all', () => {
    expect(adapt(entity({ claims: undefined })).geometry.value.center).toEqual({
      lat: 0,
      lng: 0,
    })
  })

  test('falls back to 0,0 with no coordinate claim', () => {
    expect(adapt(entity()).geometry.value.center).toEqual({ lat: 0, lng: 0 })
  })

  test('falls back to 0,0 for a malformed coordinate value', () => {
    const place = adapt(entity({ claims: { P625: [claim({ latitude: 35 })] } }))

    expect(place.geometry.value.center).toEqual({ lat: 0, lng: 0 })
  })
})

describe('photos from P18', () => {
  const withImages = (...files: string[]) =>
    adapt(entity({ claims: { P18: files.map((f) => claim(f)) } }))

  test('converts a Commons filename into a FilePath URL', () => {
    const place = withImages('Bank of America Stadium.jpg')

    expect(place.photos[0].value.url).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/Bank%20of%20America%20Stadium.jpg?width=800',
    )
  })

  test('strips a File: prefix before building the URL', () => {
    const place = withImages('File:Stadium.jpg')

    expect(place.photos[0].value.url).toContain('FilePath/Stadium.jpg')
    expect(place.photos[0].value.url).not.toContain('File%3A')
  })

  test('requests an 800px thumbnail rather than the full original', () => {
    const place = withImages('Stadium.jpg')

    expect(place.photos[0].value.url).toContain('width=800')
  })

  test('attributes photos to Wikimedia Commons, not Wikidata', () => {
    // The merge layer ranks by source; mis-attributing would rank them wrongly.
    const place = withImages('Stadium.jpg')

    expect(place.photos[0].sourceId).toBe(SOURCE.WIKIMEDIA)
    expect(place.photos[0].value.sourceId).toBe(SOURCE.WIKIMEDIA)
  })

  test('marks only the first image primary', () => {
    const place = withImages('One.jpg', 'Two.jpg', 'Three.jpg')

    expect(place.photos.map((p: any) => p.value.isPrimary)).toEqual([
      true,
      false,
      false,
    ])
  })

  test('caps the gallery at five images', () => {
    const place = withImages(...Array.from({ length: 8 }, (_, i) => `${i}.jpg`))

    expect(place.photos).toHaveLength(5)
  })

  test('emits no photos without a P18 claim', () => {
    expect(adapt(entity()).photos).toEqual([])
  })

  test('skips a non-string image value', () => {
    const place = adapt(entity({ claims: { P18: [claim({ id: 'Q1' })] } }))

    expect(place.photos).toEqual([])
  })

  test('adds Commons as a second source when photos exist', () => {
    const place = withImages('Bank of America Stadium.jpg')

    expect(place.sources).toHaveLength(2)
    expect(place.sources[1]).toMatchObject({
      id: SOURCE.WIKIMEDIA,
      name: 'Wikimedia Commons',
    })
    expect(place.sources[1].url).toContain(
      'File:Bank_of_America_Stadium.jpg',
    )
  })

  test('lists only Wikidata as a source when there are no photos', () => {
    const place = adapt(entity())

    expect(place.sources).toHaveLength(1)
    expect(place.sources[0].id).toBe(SOURCE.WIKIDATA)
  })
})

describe('contact info from P856', () => {
  test('extracts the official website', () => {
    const place = adapt(
      entity({ claims: { P856: [claim('https://panthers.test')] } }),
    )

    expect(place.contactInfo.website!.value).toBe('https://panthers.test')
    expect(place.contactInfo.website!.sourceId).toBe(SOURCE.WIKIDATA)
  })

  test('ignores a non-string website value', () => {
    const place = adapt(entity({ claims: { P856: [claim({ id: 'Q1' })] } }))

    expect(place.contactInfo.website).toBeNull()
  })

  test('reports empty contact info with no claims', () => {
    expect(adapt(entity({ claims: undefined })).contactInfo).toMatchObject({
      phone: null,
      email: null,
      website: null,
      socials: {},
    })
  })
})

describe('deliberate omissions', () => {
  test('never uses the Wikidata description', () => {
    // They read like "stadium in North Carolina" — worse than nothing beside a
    // Wikipedia extract.
    const place = adapt(
      entity({ descriptions: { en: { value: 'stadium in North Carolina' } } }),
    )

    expect(place.description).toBeNull()
  })

  test('reports no structured address', () => {
    expect(adapt(entity()).address).toBeNull()
  })

  test('reports no opening hours', () => {
    expect(adapt(entity()).openingHours).toBeNull()
  })
})
