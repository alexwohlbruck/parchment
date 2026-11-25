import { describe, it, expect } from 'vitest'
import {
  bookingComSearchUrl,
  bookingKind,
  bookingLinks,
  reservationPolicy,
  resySearchUrl,
  openTableSearchUrl,
  webSearchUrl,
  type BookingTarget,
} from '@/lib/place/place-booking'

const restaurant: BookingTarget = {
  name: 'Supperland',
  tags: { amenity: 'restaurant', reservation: 'recommended' },
  center: { lat: 35.2201234, lng: -80.8123456 },
  locality: 'Charlotte',
  region: 'NC',
  countryCode: 'US',
}

const hotel: BookingTarget = {
  name: 'The Ivey’s Hotel',
  tags: { tourism: 'hotel' },
  center: { lat: 35.2271, lng: -80.8431 },
  locality: 'Charlotte',
  region: 'NC',
  countryCode: 'US',
}

const providers = (target: BookingTarget) => bookingLinks(target).map(l => l.provider)

describe('reservationPolicy', () => {
  it.each(['yes', 'recommended', 'required'])('accepts %s', value => {
    expect(reservationPolicy({ reservation: value })).toBe(value)
  })

  it('ignores places that do not take bookings', () => {
    expect(reservationPolicy({ reservation: 'no' })).toBeNull()
    expect(reservationPolicy({ reservation: 'members_only' })).toBeNull()
    expect(reservationPolicy({})).toBeNull()
    expect(reservationPolicy(undefined)).toBeNull()
  })

  it('reads the plural key mappers sometimes use', () => {
    expect(reservationPolicy({ reservations: 'Required' })).toBe('required')
  })
})

describe('bookingLinks', () => {
  it('offers OpenTable, Resy and a web search for a US restaurant', () => {
    expect(providers(restaurant)).toEqual(['opentable', 'resy', 'search'])
  })

  it('offers nothing without a reservation tag', () => {
    expect(bookingLinks({ ...restaurant, tags: { amenity: 'restaurant' } })).toEqual([])
    expect(bookingLinks({ ...restaurant, tags: { amenity: 'restaurant', reservation: 'no' } })).toEqual([])
  })

  it('offers nothing for a place without a name to search for', () => {
    expect(bookingLinks({ ...restaurant, name: '  ' })).toEqual([])
  })

  it("puts the venue's own booking page first", () => {
    const links = bookingLinks({
      ...restaurant,
      tags: { ...restaurant.tags, 'website:booking': 'https://supperland.example/book' },
    })
    expect(links[0]).toEqual({ provider: 'venue', url: 'https://supperland.example/book' })
    expect(links.map(l => l.provider)).toEqual(['venue', 'opentable', 'resy', 'search'])
  })

  it('uses a tagged provider page in place of searching that provider', () => {
    const url = 'https://resy.com/cities/charlotte-nc/venues/supperland'
    const links = bookingLinks({
      ...restaurant,
      tags: { ...restaurant.tags, 'reservation:website': url },
    })
    expect(links).toContainEqual({ provider: 'resy', url })
    expect(links.map(l => l.provider)).toEqual(['resy', 'opentable', 'search'])
  })

  it('skips booking URLs that are not web links', () => {
    const tags = { ...restaurant.tags, 'website:booking': 'javascript:alert(1)' }
    expect(providers({ ...restaurant, tags })).toEqual(['opentable', 'resy', 'search'])
  })

  it('only searches the web for places that are not for dining', () => {
    const campsite = { ...restaurant, name: 'Lake Norman Campground', tags: { tourism: 'camp_site', reservation: 'required' } }
    expect(providers(campsite)).toEqual(['search'])
  })

  it('treats a place with a cuisine as dining', () => {
    expect(providers({ ...restaurant, tags: { shop: 'deli', cuisine: 'italian', reservation: 'yes' } }))
      .toContain('opentable')
  })

  it('leaves Resy out outside the US', () => {
    expect(providers({ ...restaurant, locality: 'Paris', region: 'IDF', countryCode: 'FR' }))
      .toEqual(['opentable', 'search'])
  })
})

describe('bookingKind', () => {
  it('books a table at dining places that take reservations', () => {
    expect(bookingKind({ amenity: 'restaurant', reservation: 'yes' })).toBe('table')
  })

  it('books a room at lodging even without a reservation tag', () => {
    expect(bookingKind({ tourism: 'hotel' })).toBe('stay')
    expect(bookingKind({ tourism: 'hostel', reservation: 'recommended' })).toBe('stay')
  })

  it('respects lodging tagged as not taking reservations', () => {
    expect(bookingKind({ tourism: 'motel', reservation: 'no' })).toBeNull()
  })

  it('books ahead at other places that take reservations', () => {
    expect(bookingKind({ tourism: 'camp_site', reservation: 'required' })).toBe('ahead')
  })

  it('offers nothing for untagged places that are not lodging', () => {
    expect(bookingKind({ amenity: 'restaurant' })).toBeNull()
    expect(bookingKind(undefined)).toBeNull()
  })
})

describe('bookingLinks for lodging', () => {
  it('offers Booking.com, Expedia and Google Hotels', () => {
    expect(providers(hotel)).toEqual(['bookingCom', 'expedia', 'googleHotels'])
  })

  it("puts the hotel's own booking page first", () => {
    const links = bookingLinks({ ...hotel, tags: { ...hotel.tags, 'website:booking': 'https://ivey.example/stay' } })
    expect(links.map(l => l.provider)).toEqual(['venue', 'bookingCom', 'expedia', 'googleHotels'])
  })

  it('uses a tagged Booking.com page in place of searching it', () => {
    const url = 'https://www.booking.com/hotel/us/the-iveys.html'
    const links = bookingLinks({ ...hotel, tags: { ...hotel.tags, 'reservation:website': url } })
    expect(links[0]).toEqual({ provider: 'bookingCom', url })
    expect(links.map(l => l.provider)).toEqual(['bookingCom', 'expedia', 'googleHotels'])
  })
})

describe('bookingComSearchUrl', () => {
  it('searches for the hotel in its city', () => {
    const url = new URL(bookingComSearchUrl(hotel))
    expect(url.origin + url.pathname).toBe('https://www.booking.com/searchresults.html')
    expect(url.searchParams.get('ss')).toBe('The Ivey’s Hotel, Charlotte')
  })

  it('searches by name alone without a city', () => {
    const url = new URL(bookingComSearchUrl({ ...hotel, locality: undefined }))
    expect(url.searchParams.get('ss')).toBe('The Ivey’s Hotel')
  })
})

describe('openTableSearchUrl', () => {
  it('searches by name around the place', () => {
    const url = new URL(openTableSearchUrl(restaurant))
    expect(url.origin + url.pathname).toBe('https://www.opentable.com/s')
    expect(url.searchParams.get('term')).toBe('Supperland')
    expect(url.searchParams.get('latitude')).toBe('35.22012')
    expect(url.searchParams.get('longitude')).toBe('-80.81235')
  })

  it('searches by name alone without coordinates', () => {
    const url = new URL(openTableSearchUrl({ ...restaurant, center: null }))
    expect(url.searchParams.has('latitude')).toBe(false)
  })
})

describe('resySearchUrl', () => {
  it("builds the city's search page", () => {
    expect(resySearchUrl({ ...restaurant, name: 'Dish & Co' }))
      .toBe('https://resy.com/cities/charlotte-nc/search?query=Dish+%26+Co')
  })

  it('slugs multi-word and accented city names', () => {
    expect(resySearchUrl({ ...restaurant, locality: 'San José', region: 'ca' }))
      .toMatch(/^https:\/\/resy\.com\/cities\/san-jose-ca\/search/)
  })

  it('needs a US state code and a city', () => {
    expect(resySearchUrl({ ...restaurant, region: 'North Carolina' })).toBeNull()
    expect(resySearchUrl({ ...restaurant, region: 'ON', countryCode: 'CA' })).toBeNull()
    expect(resySearchUrl({ ...restaurant, locality: undefined })).toBeNull()
  })

  it('falls back to address tags', () => {
    const target = { ...restaurant, locality: undefined, region: undefined, tags: { 'addr:city': 'Charlotte', 'addr:state': 'NC' } }
    expect(resySearchUrl(target)).toMatch(/cities\/charlotte-nc\//)
  })

  it('places an address without a country by its longitude', () => {
    expect(resySearchUrl({ ...restaurant, countryCode: undefined })).not.toBeNull()
    expect(resySearchUrl({ ...restaurant, countryCode: undefined, locality: 'Perth', region: 'WA', center: { lat: -31.95, lng: 115.86 } }))
      .toBeNull()
  })
})

describe('webSearchUrl', () => {
  it('searches for the place and its city', () => {
    expect(new URL(webSearchUrl(restaurant)).searchParams.get('q'))
      .toBe('Supperland Charlotte reservations')
  })
})
