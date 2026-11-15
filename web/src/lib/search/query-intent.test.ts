import { describe, expect, it } from 'vitest'
import { intentFilters } from './query-intent'

describe('intentFilters', () => {
  it('turns open now and each tag into a results filter', () => {
    expect(intentFilters({
      intent: 'browse',
      category: { id: 'amenity/cafe', name: 'Cafe' },
      tags: { internet_access: 'wlan', 'internet_access:fee': 'no' },
      openNow: true,
      residual: '',
    })).toEqual({
      openNow: '1',
      'tag:internet_access': 'wlan',
      'tag:internet_access:fee': 'no',
    })
  })

  it('asks for no filters when the intent has none', () => {
    expect(intentFilters({ intent: 'lookup', residual: 'starbucks' })).toEqual({})
  })
})
