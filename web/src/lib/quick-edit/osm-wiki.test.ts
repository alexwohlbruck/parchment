import { describe, it, expect } from 'vitest'
import { osmWikiUrl, fieldWikiUrl } from './osm-wiki'
import type { FieldDefinition } from '@/types/quick-edit.types'

function field(partial: Partial<FieldDefinition> & { id: string }): FieldDefinition {
  return { key: partial.id, type: 'text', label: partial.id, ...partial }
}

describe('osmWikiUrl', () => {
  it('links to the tag page when there is a value', () => {
    expect(osmWikiUrl('amenity', 'cafe')).toBe(
      'https://wiki.openstreetmap.org/wiki/Tag:amenity=cafe',
    )
  })

  it('links to the key page when there is no value', () => {
    expect(osmWikiUrl('opening_hours')).toBe(
      'https://wiki.openstreetmap.org/wiki/Key:opening_hours',
    )
  })

  it('falls back to the key page for wildcard and multi-values', () => {
    expect(osmWikiUrl('addr:*')).toBe(
      'https://wiki.openstreetmap.org/wiki/Key:addr',
    )
    expect(osmWikiUrl('cuisine', 'mexican;tex-mex')).toBe(
      'https://wiki.openstreetmap.org/wiki/Key:cuisine',
    )
  })

  it('escapes values that need it', () => {
    expect(osmWikiUrl('name', 'A & B')).toContain('A%20%26%20B')
  })

  it('returns nothing without a key', () => {
    expect(osmWikiUrl('')).toBeNull()
  })
})

describe('fieldWikiUrl', () => {
  it('uses the tag the field is currently set to', () => {
    const cuisine = field({ id: 'cuisine', type: 'semiCombo' })
    expect(fieldWikiUrl(cuisine, { cuisine: 'mexican' })).toBe(
      'https://wiki.openstreetmap.org/wiki/Tag:cuisine=mexican',
    )
  })

  it('prefers the reference the schema declares', () => {
    const address = field({
      id: 'address',
      key: 'addr',
      type: 'address',
      reference: { key: 'addr:*' },
    })
    expect(fieldWikiUrl(address, {})).toBe(
      'https://wiki.openstreetmap.org/wiki/Key:addr',
    )
  })

  it('keeps free-text fields on the key page', () => {
    const name = field({ id: 'name', type: 'localized' })
    expect(fieldWikiUrl(name, { name: "Joe's Diner" })).toBe(
      'https://wiki.openstreetmap.org/wiki/Key:name',
    )
  })
})
