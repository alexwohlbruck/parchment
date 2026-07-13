import { describe, expect, it } from 'bun:test'
import { FoursquareAdapter, type FoursquarePlace } from './foursquare-adapter'
import { SOURCE } from '../../../lib/constants'

const adapter = new FoursquareAdapter()

const fullPlace: FoursquarePlace = {
  fsq_place_id: 'abc123',
  name: 'Joe’s Pizza',
  latitude: 40.7305,
  longitude: -74.0021,
  location: {
    address: '7 Carmine St',
    locality: 'New York',
    region: 'NY',
    postcode: '10014',
    country: 'US',
    formatted_address: '7 Carmine St, New York, NY 10014',
  },
  categories: [{ fsq_category_id: '13064', name: 'Pizzeria' }],
  tel: '+1 212-555-1234',
  website: 'https://joespizza.example',
  email: 'hi@joespizza.example',
  social_media: { instagram: '@joespizza', twitter: 'joespizza', facebook_id: '999' },
  hours: {
    display: 'Mon–Sun 11:00–23:00',
    open_now: true,
    regular: [
      { day: 1, open: '1100', close: '2300' }, // Monday
      { day: 7, open: '1100', close: '2300' }, // Sunday
    ],
  },
  rating: 8.6,
  price: 1,
  photos: [
    { id: 'p1', prefix: 'https://fastly.4sqi.net/img/general/', suffix: '/photo1.jpg', width: 1920, height: 1080 },
  ],
  tips: [{ text: 'Best slice in the Village' }],
  stats: { total_ratings: 4210, total_tips: 320, total_photos: 88 },
}

describe('FoursquareAdapter', () => {
  it('maps identity, geometry and external id', () => {
    const place = adapter.adaptPlace(fullPlace)
    expect(place.id).toBe(`${SOURCE.FOURSQUARE}/abc123`)
    expect(place.externalIds[SOURCE.FOURSQUARE]).toBe('abc123')
    expect(place.name.value).toBe('Joe’s Pizza')
    expect(place.name.sourceId).toBe(SOURCE.FOURSQUARE)
    expect(place.geometry.value.center).toEqual({ lat: 40.7305, lng: -74.0021 })
    expect(place.placeType.value).toBe('Pizzeria')
  })

  it('normalizes the 0–10 rating to a 0–1 scale and pulls review count from stats', () => {
    const place = adapter.adaptPlace(fullPlace)
    expect(place.ratings?.rating.value).toBe(0.86)
    expect(place.ratings?.reviewCount.value).toBe(4210)
  })

  it('assembles the full-resolution photo url from prefix/suffix', () => {
    const place = adapter.adaptPlace(fullPlace)
    expect(place.photos).toHaveLength(1)
    expect(place.photos[0].value.url).toBe(
      'https://fastly.4sqi.net/img/general/original/photo1.jpg',
    )
    expect(place.photos[0].value.isPrimary).toBe(true)
  })

  it('converts Foursquare 1–7 (Mon–Sun) days to 0–6 (Sun–Sat) and HHMM to HH:mm', () => {
    const place = adapter.adaptPlace(fullPlace)
    const hours = place.openingHours?.value.regularHours
    expect(hours).toEqual([
      { day: 1, open: '11:00', close: '23:00' }, // Monday stays 1
      { day: 0, open: '11:00', close: '23:00' }, // Sunday 7 → 0
    ])
  })

  it('maps contact info and social handles to full urls', () => {
    const place = adapter.adaptPlace(fullPlace)
    expect(place.contactInfo.phone?.value).toBe('+1 212-555-1234')
    expect(place.contactInfo.website?.value).toBe('https://joespizza.example')
    expect(place.contactInfo.socials.instagram.value).toBe(
      'https://instagram.com/joespizza',
    )
    expect(place.contactInfo.socials.twitter.value).toBe(
      'https://twitter.com/joespizza',
    )
    expect(place.contactInfo.socials.facebook.value).toBe(
      'https://facebook.com/999',
    )
  })

  it('builds a formatted address and price amenity', () => {
    const place = adapter.adaptPlace(fullPlace)
    expect(place.address?.value.formatted).toBe('7 Carmine St, New York, NY 10014')
    expect(place.address?.value.postalCode).toBe('10014')
    expect(place.amenities.price_level.value).toBe('1')
  })

  it('handles a lean search result with no premium fields', () => {
    const lean: FoursquarePlace = {
      fsq_place_id: 'xyz789',
      name: 'Corner Store',
      latitude: 51.5,
      longitude: -0.12,
      location: { locality: 'London', country: 'GB' },
      categories: [{ id: '17069', name: 'Convenience Store' }],
    }
    const place = adapter.adaptPlace(lean)
    expect(place.name.value).toBe('Corner Store')
    expect(place.photos).toEqual([])
    expect(place.openingHours).toBeNull()
    expect(place.ratings).toBeUndefined()
    expect(place.contactInfo.phone).toBeNull()
    expect(place.address?.value.locality).toBe('London')
  })

  it('does not crash on an empty-ish place', () => {
    const place = adapter.adaptPlace({ fsq_place_id: 'empty' })
    expect(place.name.value).toBeNull()
    expect(place.geometry.value.center).toEqual({ lat: 0, lng: 0 })
    expect(place.address).toBeNull()
  })
})

describe('FoursquareAdapter.adaptReviews', () => {
  it('maps tips to attributed reviews', () => {
    const reviews = adapter.adaptReviews([
      {
        fsq_tip_id: 't1',
        text: 'Best slice in the Village',
        created_at: '2018-11-23T14:15:49.000Z',
        lang: 'en',
        agree_count: 12,
        disagree_count: 0,
        url: 'https://foursquare.com/tip/t1',
      },
    ])
    expect(reviews).toHaveLength(1)
    expect(reviews[0].sourceId).toBe(SOURCE.FOURSQUARE)
    expect(reviews[0].value).toEqual({
      id: 't1',
      text: 'Best slice in the Village',
      createdAt: '2018-11-23T14:15:49.000Z',
      language: 'en',
      helpfulCount: 12,
      url: 'https://foursquare.com/tip/t1',
    })
    // Foursquare tips are unrated and anonymous.
    expect(reviews[0].value.rating).toBeUndefined()
    expect(reviews[0].value.authorName).toBeUndefined()
  })

  it('skips tips without an id or text, and trims', () => {
    const reviews = adapter.adaptReviews([
      { fsq_tip_id: '', text: 'no id' },
      { fsq_tip_id: 't2', text: '   ' },
      { fsq_tip_id: 't3', text: '  keep me  ' },
    ])
    expect(reviews).toHaveLength(1)
    expect(reviews[0].value).toMatchObject({ id: 't3', text: 'keep me' })
  })

  it('returns empty for no tips', () => {
    expect(adapter.adaptReviews([])).toEqual([])
  })
})

describe('FoursquareAdapter attributes → OSM tags', () => {
  it('maps boolean attributes to official OSM tag keys/values', () => {
    const place = adapter.adaptPlace({
      fsq_place_id: 'a',
      attributes: {
        outdoor_seating: true,
        delivery: false,
        reservations: true,
        restroom: true,
        takes_credit_card: true,
        has_parking: false,
        wifi: 'n',
      },
    })
    expect(place.tags).toMatchObject({
      outdoor_seating: 'yes',
      delivery: 'no',
      reservation: 'yes', // singular OSM key
      toilets: 'yes',
      'payment:credit_cards': 'yes',
      parking: 'no',
      internet_access: 'no', // wifi "n" → no
    })
  })

  it('maps free/paid wifi to internet_access wlan + fee', () => {
    expect(
      adapter.adaptPlace({ fsq_place_id: 'a', attributes: { wifi: 'free' } })
        .tags,
    ).toMatchObject({ internet_access: 'wlan', 'internet_access:fee': 'no' })
    expect(
      adapter.adaptPlace({ fsq_place_id: 'a', attributes: { wifi: 'paid' } })
        .tags,
    ).toMatchObject({ internet_access: 'wlan', 'internet_access:fee': 'yes' })
  })

  it('maps tastes into cuisine (tags + amenities), and menu into website:menu', () => {
    const place = adapter.adaptPlace({
      fsq_place_id: 'a',
      tastes: ['Brunch Food', 'cocktails', 'Ribs'],
      menu: 'https://x.example/menu',
    })
    expect(place.tags?.cuisine).toBe('brunch_food;cocktails;ribs')
    expect(place.amenities.cuisine.value).toBe('brunch_food;cocktails;ribs')
    expect(place.tags?.['website:menu']).toBe('https://x.example/menu')
  })

  it('maps popularity and hours_popular, and date_closed → permanently closed', () => {
    const place = adapter.adaptPlace({
      fsq_place_id: 'a',
      popularity: 0.99,
      hours_popular: [{ day: 7, open: '1800', close: '2100' }],
      date_closed: '2025-01-01',
    })
    expect(place.popularity?.value).toBe(0.99)
    expect(place.popularHours?.value.regularHours).toEqual([
      { day: 0, open: '18:00', close: '21:00' },
    ])
    expect(place.openingHours?.value.isPermanentlyClosed).toBe(true)
  })
})
