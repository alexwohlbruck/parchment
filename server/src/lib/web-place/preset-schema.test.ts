import { describe, expect, test } from 'bun:test'
import { getPresetFields, matchTags } from '../osm-presets'
import { CATEGORY_TAGS } from './osm-tags'
import { businessPresetIds, checkClaims, isOsmHours, presetFieldSpecs } from './preset-schema'

test('every schema.org type maps to a preset the schema has', () => {
  for (const tags of Object.values(CATEGORY_TAGS)) {
    const preset = matchTags(tags)?.preset
    expect(Object.entries(preset?.tags ?? {}).every(([key, value]) => tags[key] === value)).toBe(true)
  }
})

test('offers models only specific business presets', () => {
  const ids = businessPresetIds()
  expect(ids).toContain('shop/musical_instrument')
  expect(ids).toContain('amenity/restaurant')
  expect(ids).not.toContain('shop')
  expect(ids).not.toContain('highway/bus_stop')
})

test('resolves the fields a preset inherits from its templates', () => {
  const keys = getPresetFields({ id: 'shop/bakery', name: 'Bakery', tags: { shop: 'bakery' }, geometry: ['point'], fields: ['{shop}'], moreFields: ['{shop}'] }).map((field) => field.key)
  expect(keys).toContain('wheelchair')
  expect(keys).toContain('email')
  expect(new Set(keys).size).toBe(keys.length)
})

describe('checkClaims', () => {
  const specs = presetFieldSpecs('amenity/restaurant')
  const page = 'Neapolitan pizza and Uzbek plov. Vegan options available. Takeout only on Mondays. Seats 40. Wheelchair accessible.'

  test('the restaurant preset asks about the fields its pages can answer', () => {
    const keys = specs.map((spec) => spec.key)
    expect(keys).toEqual(expect.arrayContaining(['cuisine', 'diet:', 'takeaway', 'outdoor_seating', 'wheelchair']))
    expect(keys).not.toContain('name')
    expect(keys).not.toContain('opening_hours')
  expect(keys).not.toContain('brand')
  })

  test('keeps values the schema allows and the page quotes', () => {
    const { tags, rejected } = checkClaims(
      {
        cuisine: { value: 'pizza;uzbek', quote: 'Neapolitan pizza and Uzbek plov' },
        'diet:': { value: 'vegan', quote: 'Vegan options available' },
        capacity: { value: '40', quote: 'Seats 40' },
        wheelchair: { value: 'yes', quote: 'wheelchair  accessible' },
        outdoor_seating: null,
      },
      specs,
      page,
    )
    expect(tags).toEqual({ cuisine: 'pizza;uzbek', 'diet:vegan': 'yes', capacity: '40', wheelchair: 'yes' })
    expect(rejected).toEqual([])
  })

  test('drops made-up fields, values and quotes', () => {
    const { tags, rejected } = checkClaims(
      {
        cuisine: { value: 'french', quote: 'Neapolitan pizza' },
        takeaway: { value: 'sometimes', quote: 'Takeout only on Mondays' },
        delivery: { value: 'yes', quote: 'We deliver citywide' },
        capacity: { value: '60', quote: 'Seats 40' },
        michelin_stars: { value: '1', quote: 'Neapolitan pizza' },
      },
      specs,
      page,
    )
    expect(tags).toEqual({})
    expect(rejected.map(({ key }) => key).sort()).toEqual(['capacity', 'cuisine', 'delivery', 'michelin_stars', 'takeaway'])
  })
})

test('takes only hours the OSM parser reads without guessing', () => {
  expect(isOsmHours('Mo-Fr 07:00-14:00; Sa 10:00-14:00')).toBe(true)
  expect(isOsmHours('7am-2pm')).toBe(false)
  expect(isOsmHours('weekdays')).toBe(false)
  expect(isOsmHours('Mo-Sa 06:45-19:00,17:00-22:00')).toBe(false)
  expect(isOsmHours('Mo-Fr 11:00-14:00,17:00-22:00')).toBe(true)
})
