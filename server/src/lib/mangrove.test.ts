import { describe, test, expect } from 'bun:test'
import { mangroveSubject, originalSignature } from './mangrove'

describe('mangroveSubject', () => {
  test('builds a geo URI carrying the encoded name and an uncertainty', () => {
    expect(
      mangroveSubject({ name: "Amelie's Café", lat: 35.2271, lng: -80.8431 }),
    ).toBe("geo:35.2271,-80.8431?q=Amelie's%20Caf%C3%A9&u=50")
  })
})

describe('originalSignature', () => {
  test('is the review itself for an original review', () => {
    expect(
      originalSignature({ signature: 'abc', payload: { sub: 'geo:0,0?q=X&u=30' } }),
    ).toBe('abc')
  })

  test('is the edited review for an edit', () => {
    expect(
      originalSignature({
        signature: 'edit',
        payload: { sub: 'urn:maresi:orig', action: 'edit' },
      }),
    ).toBe('orig')
  })
})
