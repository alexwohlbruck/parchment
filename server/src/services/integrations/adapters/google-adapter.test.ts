/**
 * Unit tests for the Google Places adapter.
 *
 * The rating normalization is the one genuinely lossy transform here: Google
 * reports 0–5 stars and the unified shape stores 0–1, so `rating / 5` rounded
 * to two places. Skipping it would show every Google place as a perfect score
 * next to sources that already normalize.
 *
 * Photo URLs embed the API key, which is why the adapter takes one via
 * `setApiKey` — the tests confirm a photo without a usable `name` is dropped
 * rather than emitting a URL with `undefined` in the path.
 */

import { describe, test, expect, mock } from 'bun:test'
import { SOURCE } from '../../../lib/constants'

mock.module('../../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { GoogleAdapter } = await import('./google-adapter')

function adapter(apiKey = 'google-key') {
  const instance = new GoogleAdapter()
  instance.setApiKey(apiKey)
  return instance
}

function details(over: Partial<any> = {}): any {
  return {
    id: 'ChIJ123',
    displayName: { text: 'Joe’s Cafe' },
    types: ['cafe', 'food'],
    location: { latitude: 35.2, longitude: -80.8 },
    ...over,
  }
}

const adaptDetails = (data: any, id?: string) =>
  adapter().placeInfo.adaptPlaceDetails(data, id)

describe('place details — identity', () => {
  test('builds the id from the Google place id', () => {
    const place = adaptDetails(details())

    expect(place.id).toBe(`${SOURCE.GOOGLE}/ChIJ123`)
    expect(place.externalIds[SOURCE.GOOGLE]).toBe('ChIJ123')
  })

  test('honours an explicit id override', () => {
    expect(adaptDetails(details(), 'custom/id').id).toBe('custom/id')
  })

  test('uses the supplied Google Maps URI', () => {
    const place = adaptDetails(
      details({ googleMapsUri: 'https://maps.google.com/place/abc' }),
    )

    expect(place.sources[0].url).toBe('https://maps.google.com/place/abc')
  })

  test('synthesizes a Maps URL when none is supplied', () => {
    expect(adaptDetails(details()).sources[0].url).toBe(
      'https://maps.google.com/?place_id=ChIJ123',
    )
  })

  test('maps the display name and first type', () => {
    const place = adaptDetails(details())

    expect(place.name.value).toBe('Joe’s Cafe')
    expect(place.placeType.value).toBe('cafe')
  })

  test('reports a null name when Google omits it', () => {
    expect(adaptDetails(details({ displayName: undefined })).name.value).toBeNull()
  })

  test('falls back to "unknown" with no types', () => {
    expect(adaptDetails(details({ types: undefined })).placeType.value).toBe(
      'unknown',
    )
  })

  test('maps the location to a centre point', () => {
    expect(adaptDetails(details()).geometry.value.center).toEqual({
      lat: 35.2,
      lng: -80.8,
    })
  })

  test('falls back to 0,0 when the location is absent', () => {
    expect(
      adaptDetails(details({ location: undefined })).geometry.value.center,
    ).toEqual({ lat: 0, lng: 0 })
  })
})

describe('ratings normalization', () => {
  test('normalizes a 0–5 star rating to the 0–1 scale', () => {
    const place = adaptDetails(details({ rating: 4.5, userRatingCount: 120 }))

    expect(place.ratings!.rating.value).toBe(0.9)
    expect(place.ratings!.reviewCount.value).toBe(120)
  })

  test('rounds the normalized rating to two decimals', () => {
    const place = adaptDetails(details({ rating: 4.3 }))

    expect(place.ratings!.rating.value).toBe(0.86)
  })

  test('handles a perfect score', () => {
    expect(adaptDetails(details({ rating: 5 })).ratings!.rating.value).toBe(1)
  })

  test('defaults the review count to zero', () => {
    expect(
      adaptDetails(details({ rating: 4 })).ratings!.reviewCount.value,
    ).toBe(0)
  })

  test('omits ratings entirely when Google reports none', () => {
    expect(adaptDetails(details()).ratings).toBeUndefined()
  })

  test('keeps a zero rating rather than treating it as missing', () => {
    expect(adaptDetails(details({ rating: 0 })).ratings!.rating.value).toBe(0)
  })
})

describe('photos', () => {
  const photo = (name: string, over: Partial<any> = {}) => ({
    name,
    widthPx: 1200,
    heightPx: 800,
    ...over,
  })

  test('builds a photo URL carrying the API key', () => {
    const place = adaptDetails(
      details({ photos: [photo('places/ChIJ123/photos/PHOTOREF')] }),
    )

    expect(place.photos[0].value.url).toContain('photo_reference=PHOTOREF')
    expect(place.photos[0].value.url).toContain('key=google-key')
  })

  test('carries the photo dimensions', () => {
    const place = adaptDetails(
      details({ photos: [photo('places/ChIJ123/photos/REF')] }),
    )

    expect(place.photos[0].value).toMatchObject({ width: 1200, height: 800 })
  })

  test('marks only the first photo primary', () => {
    const place = adaptDetails(
      details({
        photos: [
          photo('places/a/photos/ONE'),
          photo('places/a/photos/TWO'),
          photo('places/a/photos/THREE'),
        ],
      }),
    )

    expect(place.photos.map((p: any) => p.value.isPrimary)).toEqual([
      true,
      false,
      false,
    ])
  })

  test('drops a photo with no name rather than emitting a broken URL', () => {
    const place = adaptDetails(
      details({ photos: [{ widthPx: 100 }, photo('places/a/photos/OK')] }),
    )

    expect(place.photos).toHaveLength(1)
    expect(place.photos[0].value.url).toContain('OK')
  })

  test('emits no photos when Google returns none', () => {
    expect(adaptDetails(details()).photos).toEqual([])
    expect(adaptDetails(details({ photos: [] })).photos).toEqual([])
  })
})

describe('contact info and description', () => {
  test('maps the international phone number and website', () => {
    const place = adaptDetails(
      details({
        internationalPhoneNumber: '+1 704-555-0100',
        websiteUri: 'https://cafe.test',
      }),
    )

    expect(place.contactInfo.phone!.value).toBe('+1 704-555-0100')
    expect(place.contactInfo.website!.value).toBe('https://cafe.test')
  })

  test('nulls contact fields Google did not return', () => {
    const place = adaptDetails(details())

    expect(place.contactInfo).toMatchObject({
      phone: null,
      email: null,
      website: null,
      socials: {},
    })
  })

  test('uses the editorial summary as the description', () => {
    const place = adaptDetails(
      details({ editorialSummary: { text: 'A cosy corner cafe.' } }),
    )

    expect(place.description!.value).toBe('A cosy corner cafe.')
  })

  test('reports a null description without an editorial summary', () => {
    expect(adaptDetails(details()).description).toBeNull()
  })
})

describe('amenities', () => {
  test('records each place type', () => {
    const place = adaptDetails(details())

    expect(place.amenities['type:cafe']).toBe('cafe')
    expect(place.amenities['type:food']).toBe('food')
  })

  test('stringifies scalar attributes', () => {
    const place = adaptDetails(
      details({
        priceLevel: 2,
        businessStatus: 'OPERATIONAL',
        utcOffsetMinutes: -300,
      }),
    )

    expect(place.amenities.price_level).toBe('2')
    expect(place.amenities.business_status).toBe('OPERATIONAL')
    expect(place.amenities.utc_offset_minutes).toBe('-300')
  })

  test('stringifies boolean service flags', () => {
    const place = adaptDetails(
      details({ dineIn: true, delivery: false, servesCoffee: true }),
    )

    expect(place.amenities.dine_in).toBe('true')
    expect(place.amenities.delivery).toBe('false')
    expect(place.amenities.serves_coffee).toBe('true')
  })

  test('omits flags Google did not return', () => {
    const place = adaptDetails(details())

    expect(place.amenities.dine_in).toBeUndefined()
    expect(place.amenities.restroom).toBeUndefined()
  })

  test('preserves a zero UTC offset', () => {
    const place = adaptDetails(details({ utcOffsetMinutes: 0 }))

    expect(place.amenities.utc_offset_minutes).toBe('0')
  })
})

describe('address', () => {
  test('is null with no address data at all', () => {
    expect(adaptDetails(details()).address).toBeNull()
  })

  test('carries the formatted address', () => {
    const place = adaptDetails(
      details({ formattedAddress: '123 Main St, Charlotte, NC 28202, USA' }),
    )

    expect(place.address!.value.formatted).toBe(
      '123 Main St, Charlotte, NC 28202, USA',
    )
  })

  test('maps address components', () => {
    const place = adaptDetails(
      details({
        formattedAddress: '123 Main St',
        addressComponents: [
          { types: ['street_number'], longText: '123', shortText: '123' },
          { types: ['route'], longText: 'Main St', shortText: 'Main St' },
          { types: ['locality'], longText: 'Charlotte', shortText: 'Charlotte' },
          { types: ['postal_code'], longText: '28202', shortText: '28202' },
        ],
      }),
    )

    expect(place.address!.value.street1).toContain('Main St')
    expect(place.address!.value.locality).toBe('Charlotte')
    expect(place.address!.value.postalCode).toBe('28202')
  })
})

describe('autocomplete predictions', () => {
  const prediction = (over: Partial<any> = {}) => ({
    placeId: 'ChIJ123',
    mainText: 'Joe’s Cafe',
    secondaryText: 'Main St, Charlotte, NC',
    types: ['cafe'],
    ...over,
  })

  const adaptPrediction = (p: any, id?: string) =>
    adapter().autocomplete.adaptPrediction(p, id)

  test('maps the main text to the name', () => {
    expect(adaptPrediction(prediction()).name.value).toBe('Joe’s Cafe')
  })

  test('uses the secondary text as a formatted address', () => {
    expect(adaptPrediction(prediction()).address!.value.formatted).toBe(
      'Main St, Charlotte, NC',
    )
  })

  test('reports a null address without secondary text', () => {
    expect(
      adaptPrediction(prediction({ secondaryText: undefined })).address,
    ).toBeNull()
  })

  test('has no coordinates — predictions carry none', () => {
    // A prediction is a name, not a located place; 0,0 is the placeholder until
    // the caller fetches details.
    expect(adaptPrediction(prediction()).geometry.value.center).toEqual({
      lat: 0,
      lng: 0,
    })
  })

  test('falls back to "establishment" with no types', () => {
    expect(
      adaptPrediction(prediction({ types: undefined })).placeType.value,
    ).toBe('establishment')
  })

  test('records types as amenities', () => {
    const place = adaptPrediction(prediction({ types: ['cafe', 'food'] }))

    expect(place.amenities['type:cafe']).toBe('cafe')
    expect(place.amenities['type:food']).toBe('food')
  })

  test('carries no photos, hours or contact info', () => {
    const place = adaptPrediction(prediction())

    expect(place.photos).toEqual([])
    expect(place.openingHours).toBeNull()
    expect(place.contactInfo.phone).toBeNull()
  })
})
