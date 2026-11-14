import { describe, test, expect } from 'bun:test'
import { resolveDisplayChips } from './display-chips'
import type { TranslateFn } from './i18n/i18n.types'

const t = ((key: string) => key) as TranslateFn

function searchIds(tags: Record<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(
    resolveDisplayChips(tags, t).chips.map((c) => [`${c.key}=${c.value}`, c.searchId]),
  )
}

describe('display chip search ids', () => {
  test('a chip opens the attribute or group that finds its tag', () => {
    expect(searchIds({
      outdoor_seating: 'garden',
      toilets: 'yes',
      takeaway: 'yes',
      wheelchair: 'yes',
    })).toEqual({
      'outdoor_seating=garden': 'outdoor_seating/yes',
      'toilets=yes': 'group/restrooms',
      'takeaway=yes': 'takeaway/yes',
      'wheelchair=yes': 'wheelchair/yes',
    })
  })

  test('a chip needing several tags matches only when the place has them all', () => {
    expect(searchIds({ internet_access: 'wlan', 'internet_access:fee': 'no' }))
      .toEqual({ 'internet_access=wlan': 'internet_access:fee/no' })
    expect(searchIds({ internet_access: 'wlan', 'internet_access:fee': 'yes' }))
      .toEqual({ 'internet_access=wlan': undefined })
  })

  test('chips nothing searches for, or that say a place lacks something, stay plain', () => {
    expect(searchIds({ cocktails: 'yes', outdoor_seating: 'no', dog: 'no' })).toEqual({
      'cocktails=yes': undefined,
      'outdoor_seating=no': undefined,
      'dog=no': undefined,
    })
  })
})
