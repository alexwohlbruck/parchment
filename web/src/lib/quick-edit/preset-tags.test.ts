import { describe, expect, it } from 'vitest'
import { retagForPreset } from './preset-tags'

const address = {
  'addr:housenumber': '204',
  'addr:street': 'West 55th Street',
  'addr:postcode': '10019',
}

describe('retagForPreset', () => {
  it('adds a type to a bare address', () => {
    const cafe = { id: 'amenity/cafe', tags: { amenity: 'cafe' } }
    expect(retagForPreset(address, { id: 'address', tags: { 'addr:*': '*' } }, cafe)).toEqual({
      ...address,
      amenity: 'cafe',
    })
  })

  it('replaces the old type and keeps everything else', () => {
    const tags = { ...address, name: 'Old Bank', amenity: 'bank', building: 'yes' }
    const result = retagForPreset(
      tags,
      { id: 'amenity/bank', tags: { amenity: 'bank' } },
      { id: 'shop/bakery', tags: { shop: 'bakery' } },
    )
    expect(result).toEqual({ ...address, name: 'Old Bank', building: 'yes', shop: 'bakery' })
  })

  it('removes the old addTags and writes the new ones', () => {
    const result = retagForPreset(
      { amenity: 'fuel', fuel: 'yes', compressed_air: 'yes' },
      { id: 'amenity/fuel', tags: { amenity: 'fuel' }, addTags: { amenity: 'fuel', fuel: 'yes' } },
      { id: 'shop/convenience', tags: { shop: 'convenience' }, addTags: { shop: 'convenience', opening_hours: '24/7' } },
    )
    expect(result).toEqual({ compressed_air: 'yes', shop: 'convenience', opening_hours: '24/7' })
  })

  it('keeps a tag the user changed away from the old preset value', () => {
    const result = retagForPreset(
      { building: 'retail' },
      { id: 'building', tags: { building: 'yes' } },
      { id: 'shop/clothes', tags: { shop: 'clothes' } },
    )
    expect(result).toEqual({ building: 'retail', shop: 'clothes' })
  })

  it('never removes or writes wildcard tags', () => {
    const result = retagForPreset(
      { building: 'yes' },
      { id: 'building', tags: { building: '*' } },
      { id: 'craft/brewery', tags: { shop: '*', craft: 'brewery' } },
    )
    expect(result).toEqual({ building: 'yes', craft: 'brewery' })
  })

  it('drops the old chain when the type changes', () => {
    const result = retagForPreset(
      { ...address, amenity: 'bank', name: 'Chase', brand: 'Chase', 'brand:wikidata': 'Q524629' },
      { id: 'amenity/bank', tags: { amenity: 'bank' } },
      { id: 'amenity/cafe', tags: { amenity: 'cafe' } },
    )
    expect(result).toEqual({ ...address, name: 'Chase', amenity: 'cafe' })
  })
})
