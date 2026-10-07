import { describe, test, expect, beforeAll } from 'bun:test'
import { initialization } from './i18n/translate'
import { peliasLayerLabel, placeTypeLabel } from './place-type-label'
import { getPlaceType } from './osm-presets'

beforeAll(async () => {
  await initialization
})

describe('placeTypeLabel', () => {
  test('a US boundary is named by its border_type, not its admin_level', () => {
    // Charlotte and a village are both admin_level=8.
    expect(placeTypeLabel({ boundary: 'administrative', admin_level: '8', border_type: 'city' })).toBe('City')
    expect(placeTypeLabel({ boundary: 'administrative', admin_level: '8', border_type: 'village' })).toBe('Village')
    expect(placeTypeLabel({ boundary: 'administrative', admin_level: '6', border_type: 'county' })).toBe('County')
    expect(placeTypeLabel({ boundary: 'administrative', admin_level: '4', border_type: 'state' })).toBe('State')
  })

  test('falls back to admin_level where no border_type is tagged', () => {
    expect(placeTypeLabel({ boundary: 'administrative', admin_level: '2' })).toBe('Country')
    expect(placeTypeLabel({ boundary: 'administrative', admin_level: '9' })).toBe('Neighborhood')
  })

  test('place=* wins over the boundary it sits on', () => {
    expect(placeTypeLabel({ place: 'country' })).toBe('Country')
    expect(placeTypeLabel({ boundary: 'administrative', admin_level: '6', place: 'county' })).toBe('County')
    expect(placeTypeLabel({ place: 'suburb' })).toBe('Neighborhood')
  })

  test('postal codes and localized labels', () => {
    expect(placeTypeLabel({ boundary: 'postal_code', postal_code: '10997' })).toBe('Postal code')
    expect(placeTypeLabel({ boundary: 'administrative', border_type: 'state' }, 'es-ES')).toBe('Estado')
  })

  test('anything that is not a division keeps its preset', () => {
    expect(placeTypeLabel({ amenity: 'cafe' })).toBeNull()
    expect(placeTypeLabel({ place: 'island' })).toBeNull()
    expect(placeTypeLabel({ boundary: 'protected_area' })).toBeNull()
  })
})

describe('getPlaceType', () => {
  test('a boundary polygon is no longer just an "Area"', () => {
    expect(getPlaceType({ boundary: 'administrative', admin_level: '6', border_type: 'county', name: 'Mecklenburg County' }, 'en-US', 'area'))
      .toBe('County')
  })

  test('a place=country node is a Country, not a "Place"', () => {
    expect(getPlaceType({ place: 'country', name: 'United States' }, 'en-US', 'point')).toBe('Country')
  })

  test('ordinary places still take their preset names', () => {
    expect(getPlaceType({ amenity: 'cafe', name: 'Smelly Cat' }, 'en-US', 'point')).toBe('Cafe')
  })
})

describe('peliasLayerLabel', () => {
  test('a postal code is not an address', () => {
    expect(peliasLayerLabel('postalcode')).toBe('Postal code')
    expect(peliasLayerLabel('locality')).toBe('City')
  })

  test('addresses, streets and venues are left alone', () => {
    expect(peliasLayerLabel('address')).toBeNull()
    expect(peliasLayerLabel('street')).toBeNull()
    expect(peliasLayerLabel(null)).toBeNull()
  })
})
