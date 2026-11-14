import { describe, it, expect } from 'vitest'
import {
  filterByPlaceTypes,
  placeTypeFacets,
  placeTypeKey,
} from './place-type-filter'
import type { Bookmark } from '@/types/library.types'

let nextId = 0

function place(icon: string, overrides: Partial<Bookmark> = {}): Bookmark {
  nextId++
  return {
    id: `bm-${nextId}`,
    externalIds: { osm: `node/${nextId}` },
    name: `Place ${nextId}`,
    lat: 0,
    lng: 0,
    icon,
    iconPack: 'maki',
    iconColor: 'amber',
    userId: 'u',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

const labels = { cafe: 'Cafe', bar: 'Bar', park: 'Park', Home: 'Home' }

describe('placeTypeFacets', () => {
  it('counts each type, most common first', () => {
    const facets = placeTypeFacets(
      [place('bar'), place('cafe'), place('bar'), place('park')],
      labels,
    )
    expect(facets.map(f => [f.label, f.count])).toEqual([
      ['Bar', 2],
      ['Cafe', 1],
      ['Park', 1],
    ])
  })

  it('wears the look of the rows it stands for', () => {
    const [cafe] = placeTypeFacets(
      [place('cafe', { iconColor: 'forest' }), place('cafe'), place('bar')],
      labels,
    )
    expect(cafe).toMatchObject({ icon: 'cafe', iconPack: 'maki', color: 'forest' })
  })

  it('offers nothing when the list holds a single type', () => {
    expect(placeTypeFacets([place('cafe'), place('cafe')], labels)).toEqual([])
  })

  it('skips types it has no name for', () => {
    expect(placeTypeFacets([place('cafe'), place('triangle')], labels)).toEqual([])
  })

  it('types a frequent by the look it is drawn with', () => {
    const home = place('cafe', { frequentType: 'home' })
    expect(placeTypeKey(home)).toBe('Home')
  })
})

describe('filterByPlaceTypes', () => {
  const cafe = place('cafe')
  const bar = place('bar')
  const park = place('park')
  const all = [cafe, bar, park]

  it('keeps every place when no type is selected', () => {
    expect(filterByPlaceTypes(all, [])).toBe(all)
  })

  it('keeps places of any selected type, in list order', () => {
    expect(filterByPlaceTypes(all, ['park', 'cafe'])).toEqual([cafe, park])
  })
})
