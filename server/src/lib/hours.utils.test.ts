/**
 * OSM opening-hours parsing.
 *
 * The status checks are ordered, and the order is the contract: a retired place
 * keeps whatever `opening_hours` it had while trading — including `24/7` — so
 * permanently closed has to be decided before any of the live statuses, or the
 * place page reports it as always open (PAR-287).
 */

import { describe, test, expect } from 'bun:test'
import { parseOsmHours } from './hours.utils'

describe('parseOsmHours', () => {
  test('flags a lifecycle-prefixed place as permanently closed', () => {
    const hours = parseOsmHours({
      'disused:amenity': 'cafe',
      opening_hours: 'Mo-Fr 09:00-17:00',
    })

    expect(hours.isPermanentlyClosed).toBe(true)
  })

  test('drops the stale schedule of a permanently closed place', () => {
    // Leftover hours are what render as "Open now" — the status must stand alone.
    const hours = parseOsmHours({
      'disused:amenity': 'cafe',
      opening_hours: 'Mo-Fr 09:00-17:00',
    })

    expect(hours.regularHours).toEqual([])
  })

  test('permanently closed beats 24/7', () => {
    const hours = parseOsmHours({
      'abandoned:shop': 'convenience',
      opening_hours: '24/7',
    })

    expect(hours.isPermanentlyClosed).toBe(true)
    expect(hours.isOpen24_7).toBe(false)
  })

  test('still parses a live place normally', () => {
    const hours = parseOsmHours({
      amenity: 'cafe',
      opening_hours: 'Mo-Fr 09:00-17:00',
    })

    expect(hours.isPermanentlyClosed).toBe(false)
    expect(hours.regularHours).toHaveLength(5)
  })

  test('still detects 24/7 for a live place', () => {
    expect(parseOsmHours({ opening_hours: '24/7' }).isOpen24_7).toBe(true)
  })
})
