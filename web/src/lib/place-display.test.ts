import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  placeToDisplay,
  bookmarkToDisplay,
  recentPlaceToDisplay,
  recentSearchToDisplay,
  recentSearchRoute,
  makePlaceDisplay,
} from './place-display'
import type { Place } from '@/types/place.types'
import type { Bookmark } from '@/types/library.types'

const t = (key: string) => key
const opts = { isDark: false, t }

// Category colours resolve through the palette store.
beforeEach(() => setActivePinia(createPinia()))

function place(partial: Record<string, unknown> = {}): Place {
  return {
    id: 'p1',
    name: { value: 'Blue Bottle Coffee' },
    placeType: { value: 'cafe' },
    address: { value: { street1: '300 Webster St', locality: 'Oakland' } },
    externalIds: {},
    contactInfo: { phone: null, email: null, website: null, socials: {} },
    ...partial,
  } as unknown as Place
}

describe('placeToDisplay', () => {
  it('carries the identifying fields through', () => {
    const d = placeToDisplay(place(), opts)
    expect(d.title).toBe('Blue Bottle Coffee')
    expect(d.placeType).toBe('Cafe')
    expect(d.address).toBe('300 Webster St, Oakland')
    expect(d.route).toEqual(expect.objectContaining({ params: expect.anything() }))
  })

  it('suppresses the type for an unnamed POI, whose title already is the type', () => {
    // No name → getSearchResultName falls back to the capitalised type.
    const d = placeToDisplay(place({ name: { value: null } }), opts)
    expect(d.title).toBe('Cafe')
    expect(d.placeType).toBeNull()
  })

  it('suppresses a geometry-type fallback rather than showing "Point"', () => {
    const d = placeToDisplay(place({ placeType: { value: 'Point' } }), opts)
    expect(d.placeType).toBeNull()
  })

  it('suppresses an address that only restates the title', () => {
    const d = placeToDisplay(
      place({ name: { value: null }, placeType: { value: 'Point' } }),
      opts,
    )
    // Title fell all the way through to the address, so the address line would
    // be a duplicate.
    expect(d.title).toBe('300 Webster St, Oakland')
    expect(d.address).toBeNull()
  })

  it('scales the stored 0–1 rating to 0–5', () => {
    const d = placeToDisplay(
      place({ ratings: { rating: { value: 0.9 }, reviewCount: { value: 1240 } } }),
      opts,
    )
    expect(d.rating).toBeCloseTo(4.5)
    expect(d.reviewCount).toBe(1240)
  })

  it('leaves the rating null when the place is unrated', () => {
    expect(placeToDisplay(place(), opts).rating).toBeNull()
  })

  it('reports open/closed only where the hours data states it', () => {
    expect(placeToDisplay(place(), opts).openState).toBeNull()

    const open = placeToDisplay(
      place({ openingHours: { value: { isOpen24_7: true } } }),
      opts,
    )
    expect(open.openState).toBe('open')
    expect(open.hoursText).toBe('place.hours.open24hours')

    const shut = placeToDisplay(
      place({ openingHours: { value: { isPermanentlyClosed: true } } }),
      opts,
    )
    expect(shut.openState).toBe('closed')
    expect(shut.hoursText).toBe('place.hours.permanentlyClosed')
  })
})

function bookmark(partial: Record<string, unknown> = {}): Bookmark {
  return {
    id: 'b1',
    name: 'My Gym',
    address: '1 Main St',
    icon: 'Dumbbell',
    iconColor: 'coral',
    externalIds: { osm: 'node/123' },
    lat: 0,
    lng: 0,
    userId: 'u1',
    createdAt: '',
    updatedAt: '',
    ...partial,
  } as unknown as Bookmark
}

describe('bookmarkToDisplay', () => {
  it('keeps the saved POI look for an untagged bookmark', () => {
    const d = bookmarkToDisplay(bookmark())
    expect(d.title).toBe('My Gym')
    expect(d.icon).toBe('Dumbbell')
    expect(d.color).toBe('coral')
    expect(d.placeType).toBeNull()
  })

  it('uses the type-fixed look for a canonical frequent', () => {
    const d = bookmarkToDisplay(bookmark({ frequentType: 'home' }))
    expect(d.icon).toBe('Home')
    expect(d.color).toBe('cobalt')
    expect(d.placeType).toBe('Home')
  })

  it('routes by external id rather than bookmark id', () => {
    expect(bookmarkToDisplay(bookmark()).route).not.toBeNull()
    expect(bookmarkToDisplay(bookmark({ externalIds: {} })).route).toBeNull()
  })
})

describe('makePlaceDisplay', () => {
  it('defaults every unsupplied field to "nothing to render"', () => {
    const d = makePlaceDisplay({ title: 'Work' })
    expect(d.title).toBe('Work')
    expect(d.icon).toBe('MapPin')
    expect(d.iconPack).toBe('lucide')
    expect(d.address).toBeNull()
    expect(d.rating).toBeNull()
    expect(d.route).toBeNull()
  })

  it('keeps what the caller supplies', () => {
    const d = makePlaceDisplay({
      title: 'Home',
      icon: 'Home',
      color: 'cobalt',
      address: '139 Rogers Avenue',
    })
    expect(d.icon).toBe('Home')
    expect(d.color).toBe('cobalt')
    expect(d.address).toBe('139 Rogers Avenue')
  })
})

describe('recentPlaceToDisplay', () => {
  it('maps the cached entry, defaulting a missing icon', () => {
    const d = recentPlaceToDisplay(
      { id: 'p9', title: 'Museum', subtitle: 'Art museum', at: 1 },
      { isDark: false },
    )
    expect(d.title).toBe('Museum')
    expect(d.icon).toBe('MapPin')
    expect(d.address).toBe('Art museum')
    expect(d.route).not.toBeNull()
  })
})

describe('recentSearchRoute', () => {
  it('re-runs a category as a category browse, not a text search', () => {
    const route = recentSearchRoute({
      query: 'Coffee',
      kind: 'category',
      categoryId: 'amenity/cafe',
      iconCategory: 'food_and_drink',
      at: 1,
    }) as { query: Record<string, string> }
    expect(route.query).toEqual({
      categoryId: 'amenity/cafe',
      categoryName: 'Coffee',
      categoryIconCategory: 'food_and_drink',
    })
  })

  it('re-runs a brand browse by key, carrying the original-cased name', () => {
    const route = recentSearchRoute({
      query: "McDonald's",
      kind: 'brand',
      brandKey: 'Q38076',
      brandName: "McDonald's",
      at: 1,
    }) as { query: Record<string, string> }
    expect(route.query).toEqual({ brandKey: 'Q38076', brandName: "McDonald's" })
  })

  it('falls back to a text search, including for a category missing its id', () => {
    expect((recentSearchRoute({ query: 'tacos', at: 1 }) as any).query).toEqual({
      q: 'tacos',
    })
    // A half-formed category entry must not navigate to an empty browse.
    expect(
      (recentSearchRoute({ query: 'Cafe', kind: 'category', at: 1 }) as any).query,
    ).toEqual({ q: 'Cafe' })
  })
})

describe('recentSearchToDisplay', () => {
  it('gives a text search the history glyph', () => {
    const d = recentSearchToDisplay({ query: 'tacos', at: 1 }, { isDark: false })
    expect(d.title).toBe('tacos')
    expect(d.icon).toBe('History')
  })

  it('keeps the stored category icon so it matches the palette', () => {
    const d = recentSearchToDisplay(
      {
        query: 'Bicycle Parking',
        kind: 'category',
        categoryId: 'amenity/bicycle_parking',
        iconName: 'bicycle',
        iconPack: 'maki',
        at: 1,
      },
      { isDark: false },
    )
    expect(d.icon).toBe('bicycle')
    expect(d.iconPack).toBe('maki')
  })

  it('renders a brand with its logo', () => {
    const d = recentSearchToDisplay(
      {
        query: 'Target',
        kind: 'brand',
        brandKey: 'Q1046951',
        brandLogoUrl: 'https://example.com/target.svg',
        at: 1,
      },
      { isDark: false },
    )
    expect(d.imageUrl).toBe('https://example.com/target.svg')
    expect(d.icon).toBe('Store')
  })
})
