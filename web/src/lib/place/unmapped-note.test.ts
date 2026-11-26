import { describe, expect, it } from 'vitest'
import { unmappedNoteText } from './unmapped-note'

const words = {
  intro: 'Cafe Wands is missing from the map.',
  opensSoon: "Its site says it hasn't opened yet.",
  replaces: "It takes over node 2603955337 (Coogan's).",
  tagsHeading: 'Suggested tags:',
}

describe('unmappedNoteText', () => {
  it('lists every tag, the type and name first and the address last', () => {
    const text = unmappedNoteText(
      {
        presetId: 'amenity/cafe',
        opensSoon: true,
        tags: {
          'addr:street': 'Union Street',
          website: 'https://cafewands.com/',
          'addr:housenumber': '215',
          name: 'Cafe Wands',
          'construction:amenity': 'cafe',
          email: 'info@cafewands.com',
        },
      },
      words,
    )
    expect(text).toBe(
      [
        "Cafe Wands is missing from the map. Its site says it hasn't opened yet.",
        '',
        'Suggested tags:',
        'construction:amenity=cafe',
        'name=Cafe Wands',
        'email=info@cafewands.com',
        'website=https://cafewands.com/',
        'addr:housenumber=215',
        'addr:street=Union Street',
      ].join('\n'),
    )
  })

  it('says which element it takes over', () => {
    const text = unmappedNoteText(
      { presetId: null, tags: { shop: 'bakery' }, replaces: { type: 'node', id: 2603955337, formerName: "Coogan's" } },
      words,
    )
    expect(text.split('\n')[0]).toBe("Cafe Wands is missing from the map. It takes over node 2603955337 (Coogan's).")
  })
})
