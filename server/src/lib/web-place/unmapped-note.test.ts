import { describe, expect, test } from 'bun:test'
import { initialization, translate } from '../i18n/translate'
import { unmappedNoteText } from './unmapped-note'

await initialization
const t = translate('en-US')

describe('unmappedNoteText', () => {
  test('lists every tag, the type and name first and the address last', () => {
    const text = unmappedNoteText(
      'Cafe Wands',
      'cafewands.com',
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
      t,
    )
    expect(text).toBe(
      [
        "Cafe Wands is missing from the map. Its website says it hasn't opened yet, so it's tagged as under construction.",
        'Found on cafewands.com with Parchment.',
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

  test('names the vacant element it takes over', () => {
    const text = unmappedNoteText(
      'Hart Bageri',
      'hartbageri.com',
      { presetId: null, tags: { name: 'Hart Bageri' }, replaces: { type: 'node', id: 2603955337, formerName: "Coogan's" } },
      t,
    )
    expect(text.split('\n')[0]).toBe("Hart Bageri is missing from the map. It takes over node 2603955337 (Coogan's), which has closed.")
  })
})
