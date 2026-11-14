import { describe, test, expect } from 'bun:test'
import type { CategoryResult } from '../types/search.types'
import { placeTypeLabels } from './place-type-labels'
import { CategoryService } from '../services/category.service'

function preset(
  id: string,
  name: string,
  iconName: string,
  tags: Record<string, string> = { [id.split('/')[0]]: id.split('/')[1] ?? '*' },
): CategoryResult {
  return {
    id,
    type: 'category',
    name,
    iconName,
    iconPack: 'maki',
    tags,
    geometry: ['point'],
    searchable: true,
  }
}

describe('placeTypeLabels', () => {
  test('an icon is named by the preset whose tag value it shares', () => {
    const labels = placeTypeLabels([
      preset('amenity/fountain', 'Fountain', 'park'),
      preset('leisure/park', 'Park', 'park'),
    ])
    expect(labels.park).toBe('Park')
  })

  test('among those, the most generic and not the building', () => {
    const labels = placeTypeLabels([
      preset('amenity/vending_machine/fuel', 'Gas Vending Machine', 'fuel', {
        amenity: 'vending_machine',
        vending: 'fuel',
      }),
      preset('amenity/fuel', 'Gas Station', 'fuel'),
      preset('building/school', 'School Building', 'school'),
      preset('education/school', 'School', 'school'),
    ])
    expect(labels.fuel).toBe('Gas Station')
    expect(labels.school).toBe('School')
  })

  test('falls back to the one most generic preset', () => {
    const labels = placeTypeLabels([
      preset('amenity/fast_food/burger', 'Burger Fast Food', 'fast-food', {
        amenity: 'fast_food',
        cuisine: 'burger',
      }),
      preset('amenity/food', 'Food', 'fast-food'),
    ])
    expect(labels['fast-food']).toBe('Food')
  })

  test('leaves out icons that no single type can name', () => {
    const labels = placeTypeLabels([
      preset('amenity/bandstand', 'Bandstand', 'music'),
      preset('amenity/dance', 'Dance Hall', 'music'),
    ])
    expect(labels).not.toHaveProperty('music')
  })

  test('ignores unsearchable presets', () => {
    const labels = placeTypeLabels([
      { ...preset('amenity/cafe', 'Cafe', 'cafe'), searchable: false },
    ])
    expect(labels).toEqual({})
  })

  test('names the common icons a saved place carries', () => {
    const labels = placeTypeLabels(new CategoryService().loadCategories('en-US'))
    expect(labels).toMatchObject({
      cafe: 'Cafe',
      restaurant: 'Restaurant',
      park: 'Park',
      lodging: 'Hotel',
      beer: 'Pub',
      shop: 'Shop',
    })
  })
})
