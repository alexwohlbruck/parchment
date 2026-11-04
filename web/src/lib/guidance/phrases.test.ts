import { describe, expect, test } from 'vitest'
import { announcementText, spokenDistance } from './phrases'
import { translator } from './test-routes'
import en from '@/lib/i18n/en-US.json'
import es from '@/lib/i18n/es-ES.json'

const t = translator(en)
const mile = 1609.344

describe('spokenDistance', () => {
  test('miles in the fractions people say', () => {
    expect([0.25, 0.6, 0.8, 1, 1.4, 2.6, 12.3].map(mi => spokenDistance(mi * mile, false, t))).toEqual([
      'a quarter mile', 'half a mile', 'three quarters of a mile', '1 mile', 'a mile and a half', '2 and a half miles', '12 miles',
    ])
    expect(spokenDistance(0.6 * mile, false, translator(es))).toBe('media milla')
  })

  test('kilometres to the half, and feet and metres as the banner shows them', () => {
    expect([1000, 1600, 3300, 4100].map(m => spokenDistance(m, true, t))).toEqual(['1 kilometer', 'a kilometer and a half', '3 and a half kilometers', '4 kilometers'])
    expect(spokenDistance(200, false, t)).toBe('650 feet')
    expect(spokenDistance(420, true, t)).toBe('400 meters')
  })
})

describe('boarding announcements', () => {
  const board = (extra: object) =>
    announcementText({ kind: 'transit', event: 'wait', line: 'A', stop: '42 St', ...extra }, false, t)

  test('say the signed direction where the platform has one', () => {
    expect(board({ headsign: 'Inwood-207 St', direction: 'Uptown & The Bronx' })).toBe('Board the A, Uptown & The Bronx')
  })

  test('fall back to the terminal, then the line alone', () => {
    expect(board({ headsign: 'Inwood-207 St' })).toBe('Board the A toward Inwood-207 St')
    expect(board({})).toBe('Board the A')
  })
})
