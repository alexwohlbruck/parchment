import { describe, it, expect } from 'bun:test'
import { searchBrands, matchBrand, brandTagDiff } from './nsi'

describe('searchBrands', () => {
  it('ranks the canonical chain above transliterations sharing its QID', () => {
    const results = searchBrands('starb', 'amenity/cafe')
    expect(results[0].name).toBe('Starbucks')
    expect(results.filter((b) => b.wikidata === 'Q37158')).toHaveLength(1)
  })

  it('ranks a far-reaching chain above a shorter-named local one', () => {
    const names = searchBrands('taco', 'amenity/fast_food').map((b) => b.name)
    expect(names[0]).toBe('Taco Bell')
  })

  it('carries the tags and logo needed to fill in a form', () => {
    const [tacoBell] = searchBrands('taco bell', 'amenity/fast_food')
    expect(tacoBell.tags['brand:wikidata']).toBe('Q752941')
    expect(tacoBell.tags.cuisine).toBe('tex-mex')
    expect(tacoBell.logoUrl).toBeTruthy()
  })

  it('finds chains typed without their punctuation', () => {
    for (const query of ['mcdonalds', "mcdonald's", 'McDonalds']) {
      expect(searchBrands(query, 'amenity/fast_food')[0].name).toBe("McDonald's")
    }
    expect(searchBrands('raising canes', 'amenity/fast_food')[0].name).toBe(
      "Raising Cane's",
    )
    expect(searchBrands('ben and jerrys', 'amenity/ice_cream')[0].name).toBe(
      "Ben & Jerry's",
    )
  })

  it('finds chains typed without their spacing', () => {
    expect(searchBrands('tacobell', 'amenity/fast_food')[0].name).toBe('Taco Bell')
  })

  it('searches the whole match group, so the chosen tag need not be exact', () => {
    expect(searchBrands('mcdonalds', 'amenity/restaurant')[0].name).toBe(
      "McDonald's",
    )
  })

  it('ignores queries too short to be meaningful', () => {
    expect(searchBrands('t', 'amenity/fast_food')).toEqual([])
  })
})

describe('matchBrand', () => {
  it('matches regardless of case and spacing', () => {
    for (const name of ['Taco Bell', 'taco bell', 'TACOBELL']) {
      expect(matchBrand('amenity/fast_food', name)?.wikidata).toBe('Q752941')
    }
  })

  it('matches a chain tagged under a sibling tag in its match group', () => {
    expect(matchBrand('amenity/restaurant', 'taco bell')?.name).toBe('Taco Bell')
  })

  it('does not match generic names the tag excludes', () => {
    expect(matchBrand('amenity/fast_food', 'pizzeria')).toBeNull()
    expect(matchBrand('amenity/fast_food', 'Imbiss')).toBeNull()
  })

  it('does not match an unrelated name', () => {
    expect(matchBrand('amenity/fast_food', "Dave's Corner Grill")).toBeNull()
  })
})

describe('brandTagDiff', () => {
  it('lists only tags that would change', () => {
    const brand = matchBrand('amenity/fast_food', 'taco bell')!
    const diff = brandTagDiff(brand, { amenity: 'fast_food', name: 'taco bell' })

    expect(diff).toContainEqual({ key: 'name', from: 'taco bell', to: 'Taco Bell' })
    expect(diff).toContainEqual({
      key: 'brand:wikidata',
      from: null,
      to: 'Q752941',
    })
    expect(diff.some((d) => d.key === 'amenity')).toBe(false)
  })

  it('is empty when the feature already carries the brand tags', () => {
    const brand = matchBrand('amenity/fast_food', 'taco bell')!
    expect(brandTagDiff(brand, brand.tags)).toEqual([])
  })
})
