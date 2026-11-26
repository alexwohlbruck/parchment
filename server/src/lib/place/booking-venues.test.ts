import { describe, expect, test } from 'bun:test'
import {
  isVenueId,
  parseVenueUrl,
  venuePageUrl,
  venueProviderOf,
  venuesFromActions,
  venuesFromWikidata,
  venueUpserts,
} from './booking-venues'

describe('parseVenueUrl', () => {
  test.each([
    ['https://www.opentable.com/r/aita-trattoria-brooklyn?corrid=abc', 'r/aita-trattoria-brooklyn'],
    ['opentable.com/r/aita-trattoria-brooklyn/', 'r/aita-trattoria-brooklyn'],
    ['https://www.opentable.co.uk/en-gb/r/dishoom-shoreditch-london', 'r/dishoom-shoreditch-london'],
    ['https://www.opentable.com/restref/client/?rid=1234&restref=1234', 'rid/1234'],
    ['https://www.opentable.com/restaurant/profile/98765', 'rid/98765'],
  ])('OpenTable %s', (url, id) => {
    expect(parseVenueUrl('opentable', url)).toBe(id)
  })

  test.each([
    ['https://resy.com/cities/new-york-ny/venues/aita-trattoria?date=2026-11-25&seats=2', 'new-york-ny/aita-trattoria'],
    ['https://resy.com/cities/ny/lilia', 'ny/lilia'],
  ])('Resy %s', (url, id) => {
    expect(parseVenueUrl('resy', url)).toBe(id)
  })

  test('Tock and SevenRooms', () => {
    expect(parseVenueUrl('tock', 'https://www.exploretock.com/atomix/experience/12345/tasting')).toBe('atomix')
    expect(parseVenueUrl('sevenrooms', 'https://www.sevenrooms.com/reservations/carbonelondon?venues=x')).toBe('carbonelondon')
    expect(parseVenueUrl('sevenrooms', 'https://www.sevenrooms.com/explore/carbonelondon/reservations/create/search')).toBe('carbonelondon')
  })

  test.each([
    ['https://www.booking.com/hotel/us/the-ludlow.html?aid=1', 'us/the-ludlow'],
    ['https://www.booking.com/hotel/gb/the-hoxton-shoreditch.en-gb.html', 'gb/the-hoxton-shoreditch'],
  ])('Booking.com %s', (url, id) => {
    expect(parseVenueUrl('bookingcom', url)).toBe(id)
  })

  test('Hotels.com hotel pages', () => {
    expect(parseVenueUrl('hotelscom', 'https://www.hotels.com/ho123456/the-ludlow-new-york-united-states-of-america/')).toBe('123456')
    expect(parseVenueUrl('hotelscom', 'https://uk.hotels.com/ho123456/')).toBe('123456')
  })

  test('Expedia hotel pages', () => {
    expect(parseVenueUrl('expedia', 'https://www.expedia.com/New-York-Hotels-The-Ludlow.h1234567.Hotel-Information?chkin=2026-11-25')).toBe('1234567')
  })

  test('rejects search pages and other sites', () => {
    expect(parseVenueUrl('opentable', 'https://www.opentable.com/s?term=aita')).toBeNull()
    expect(parseVenueUrl('resy', 'https://resy.com/cities/new-york-ny/search?query=aita')).toBeNull()
    expect(parseVenueUrl('bookingcom', 'https://www.booking.com/searchresults.html?ss=ludlow')).toBeNull()
    expect(parseVenueUrl('opentable', 'https://resy.com/cities/ny/lilia')).toBeNull()
    expect(parseVenueUrl('bookingcom', 'https://booking.com.evil.example/hotel/us/x.html')).toBeNull()
    expect(parseVenueUrl('expedia', 'not a url')).toBeNull()
  })
})

describe('venueProviderOf', () => {
  test('recognises each booking site and nothing else', () => {
    expect(venueProviderOf('https://www.opentable.com/r/x')).toBe('opentable')
    expect(venueProviderOf('https://resy.com/cities/ny/x')).toBe('resy')
    expect(venueProviderOf('https://secure.booking.com/hotel/us/x.html')).toBe('bookingcom')
    expect(venueProviderOf('https://www.expedia.co.uk/x.h1.Hotel-Information')).toBe('expedia')
    expect(venueProviderOf('https://aita-restaurant.com/reservations')).toBeNull()
  })
})

describe('venuePageUrl', () => {
  const plan = { party: 3, day: '2026-11-27', checkout: '2026-11-29', tableTime: '2026-11-27T19:00' }

  test('builds each venue page with the party and dates', () => {
    expect(venuePageUrl('opentable', 'r/aita-trattoria-brooklyn', plan)).toBe(
      'https://www.opentable.com/r/aita-trattoria-brooklyn?covers=3&dateTime=2026-11-27T19%3A00',
    )
    expect(venuePageUrl('opentable', 'rid/1234')).toBe('https://www.opentable.com/restref/client/?rid=1234')
    expect(venuePageUrl('resy', 'new-york-ny/aita-trattoria', plan)).toBe(
      'https://resy.com/cities/new-york-ny/venues/aita-trattoria?date=2026-11-27&seats=3',
    )
    expect(venuePageUrl('tock', 'atomix', plan)).toBe('https://www.exploretock.com/atomix/search?date=2026-11-27&size=3&time=19%3A00')
    expect(venuePageUrl('sevenrooms', 'carbonelondon', plan)).toBe(
      'https://www.sevenrooms.com/reservations/carbonelondon?date=2026-11-27&party_size=3',
    )
    expect(venuePageUrl('bookingcom', 'us/the-ludlow', plan)).toBe(
      'https://www.booking.com/hotel/us/the-ludlow.html?checkin=2026-11-27&checkout=2026-11-29&group_adults=3&no_rooms=1',
    )
    expect(venuePageUrl('expedia', '1234567', plan)).toBe(
      'https://www.expedia.com/h1234567.Hotel-Information?chkin=2026-11-27&chkout=2026-11-29&rm1=a3',
    )
  })

  test('refuses an id that could point anywhere else', () => {
    expect(venuePageUrl('bookingcom', '../../evil', plan)).toBeNull()
    expect(isVenueId('resy', 'ny/lilia?x=1')).toBe(false)
  })

  test('round-trips a parsed URL', () => {
    const id = parseVenueUrl('bookingcom', 'https://www.booking.com/hotel/us/the-ludlow.html')!
    expect(parseVenueUrl('bookingcom', venuePageUrl('bookingcom', id)!)).toBe(id)
  })
})

describe('venuesFromActions', () => {
  test('keeps reservation pages on booking sites, the first per site', () => {
    expect(
      venuesFromActions([
        { kind: 'reservation', url: 'https://www.opentable.com/r/the-tavern-at-gramercy-tavern-new-york' },
        { kind: 'reservation', url: 'https://resy.com/cities/new-york-ny/venues/the-dining-room-at-gramercy-tavern' },
        { kind: 'reservation', url: 'https://resy.com/cities/new-york-ny/venues/other' },
        { kind: 'reservation', url: 'https://gramercytavern.com/reserve' },
        { kind: 'delivery', url: 'https://www.ubereats.com/store/gramercy' },
      ]),
    ).toEqual({
      opentable: 'r/the-tavern-at-gramercy-tavern-new-york',
      resy: 'new-york-ny/the-dining-room-at-gramercy-tavern',
    })
  })
})

describe('venueUpserts', () => {
  test('stores new and changed venues and leaves confirmed ones alone', () => {
    expect(
      venueUpserts(
        {
          opentable: { providerPlaceId: 'r/kept', confirmed: true },
          resy: { providerPlaceId: 'ny/same', confirmed: false },
          tock: { providerPlaceId: 'old', confirmed: false },
        },
        { opentable: 'r/new', resy: 'ny/same', tock: 'new', sevenrooms: 'fresh' },
      ),
    ).toEqual({ tock: 'new', sevenrooms: 'fresh' })
  })

  test('lets a lower-ranked source only fill empty sites', () => {
    expect(
      venueUpserts(
        { expedia: { providerPlaceId: '1', confirmed: false } },
        { expedia: '2', hotelscom: '3' },
        { replace: false },
      ),
    ).toEqual({ hotelscom: '3' })
  })

  test('respects a confirmed "not listed"', () => {
    expect(venueUpserts({ resy: { providerPlaceId: null, confirmed: true } }, { resy: 'ny/x' })).toEqual({})
  })
})

describe('venuesFromWikidata', () => {
  const claim = (value: string) => [{ mainsnak: { datavalue: { value } } }]

  test('reads Booking.com, Expedia and Hotels.com ids', () => {
    expect(
      venuesFromWikidata({ P3607: claim('us/sun-river-resort'), P5651: claim('h1097488'), P3898: claim('ho421518') }),
    ).toEqual({ bookingcom: 'us/sun-river-resort', expedia: '1097488', hotelscom: '421518' })
  })

  test('tidies a leading slash and skips legacy numeric Booking.com ids', () => {
    expect(venuesFromWikidata({ P3607: claim('/ie/the-mont') })).toEqual({ bookingcom: 'ie/the-mont' })
    expect(venuesFromWikidata({ P3607: claim('38367') })).toEqual({})
    expect(venuesFromWikidata(undefined)).toEqual({})
  })

  test('builds each page from the stored id', () => {
    expect(venuePageUrl('hotelscom', '421518')).toBe('https://www.hotels.com/ho421518/')
    expect(venuePageUrl('expedia', '1097488')).toBe('https://www.expedia.com/h1097488.Hotel-Information')
  })
})
