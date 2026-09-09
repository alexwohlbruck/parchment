/**
 * The panel must list a station's lines in the order the map draws them.
 *
 * These fixtures are not invented: each is the `labels`/`route_colors`
 * pair read out of a real portolan build, already in the order
 * `sortBullets` put them — so the assertion is "this port reproduces the
 * Go, on real systems", not "this port agrees with itself".
 */
import { describe, test, expect } from 'vitest'
import {
  bulletGeometry,
  bulletHex,
  bulletLuma,
  bulletTextColor,
  lettersFirstCmp,
  naturalCmp,
  orderBullets,
} from './transit-bullets'

type Fixture = { city: string; station: string; order: Array<[string, string]> }

const FIXTURES: Fixture[] = [
  {
    // the case: MTA groups by trunk colour, letters before numbers, and
    // Apple renders it the same way
    city: 'New York',
    station: '59 St-Columbus Circle',
    order: [['A', '0062CF'], ['C', '0062CF'], ['B', 'EB6800'], ['D', 'EB6800'], ['1', 'D82233'], ['2', 'D82233']],
  },
  {
    // one colour per line: the policy degrades to the alphabetical order
    // Chicago expects
    city: 'Chicago',
    station: 'Clark/Lake',
    order: [['Blue', '00A1DE'], ['Brown', '62361B'], ['Green', '009B3A'], ['Orange', 'F9461C'], ['Pink', 'E27EA6'], ['Purple', '522398']],
  },
  {
    // numbered lines, ascending — no letter group to come first
    city: 'Mexico City',
    station: 'Tacubaya',
    order: [['1', 'F94F8E'], ['7', 'E87511'], ['9', '512826']],
  },
  {
    // three commuter branches share one colour and order naturally inside
    // it, while the groups themselves rank by their first member
    city: 'New York',
    station: 'Grand Central',
    order: [
      ['Babylon Branch', '00985F'], ['City Terminal Zone', '4D5357'],
      ['Danbury', 'EE0034'], ['New Canaan', 'EE0034'], ['New Haven', 'EE0034'],
      ['Far Rockaway Branch', '6E3219'], ['Harlem', '0039A6'],
      ['Hempstead Branch', 'CE8E00'], ['Hudson', '009B3A'],
      ['Long Beach Branch', 'FF6319'], ['Port Jefferson Branch', '006EC7'],
      ['Port Washington Branch', 'C60C30'], ['Ronkonkoma Branch', 'A626AA'],
      ['West Hempstead Branch', '00A1DE'],
    ],
  },
  {
    // non-Latin labels order by code point, as they do in the pipeline
    city: 'Tokyo',
    station: '銀座',
    order: [['丸ノ内線', 'f62e36'], ['日比谷線', 'b5b5ac'], ['銀座線', 'ff9500']],
  },
]

const shuffled = <T,>(xs: T[], seed: number): T[] => {
  const out = [...xs]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

describe('bullet order matches what portolan built', () => {
  test.each(FIXTURES)('$city — $station', ({ order }) => {
    const routes = order.map(([label, color]) => ({ label, color }))
    for (const seed of [1, 2, 3, 7, 11]) {
      const got = orderBullets(shuffled(routes, seed), r => r)
      expect(got.map(r => r.label)).toEqual(order.map(([l]) => l))
    }
  })

  test('a leading # and mixed case do not split one colour into two groups', () => {
    const got = orderBullets(
      [
        { label: 'C', color: '#0062cf' },
        { label: '1', color: 'D82233' },
        { label: 'A', color: '0062CF' },
      ],
      r => r,
    )
    expect(got.map(r => r.label)).toEqual(['A', 'C', '1'])
  })

  test('routes with no colour form one group rather than one each', () => {
    const got = orderBullets(
      [{ label: '10' }, { label: 'B' }, { label: '2' }],
      r => r,
    )
    expect(got.map(r => r.label)).toEqual(['2', '10', 'B'])
  })
})

describe('the other two policies', () => {
  const routes = [
    { label: 'B', color: 'ff0000', sortOrder: 3, id: 'b' },
    { label: '10', color: '00ff00', sortOrder: 1, id: 'j' },
    { label: '2', color: '0000ff', id: 'c' },
  ]

  test('feed: the operator’s own order, absentees last', () => {
    expect(orderBullets(routes, r => r, 'feed').map(r => r.label)).toEqual(['10', 'B', '2'])
  })

  test('natural: numbers before letters, 2 before 10', () => {
    expect(orderBullets(routes, r => r, 'natural').map(r => r.label)).toEqual(['2', '10', 'B'])
  })

  test('the input is never reordered in place', () => {
    const input = [...routes]
    orderBullets(input, r => r, 'natural')
    expect(input.map(r => r.label)).toEqual(['B', '10', '2'])
  })

  test('equal keys fall back to the id, so a redraw cannot shuffle them', () => {
    const same = [
      { label: 'X', color: 'aaaaaa', id: 'z' },
      { label: 'X', color: 'aaaaaa', id: 'a' },
    ]
    expect(orderBullets(same, r => r).map(r => r.id)).toEqual(['a', 'z'])
  })
})

describe('the comparators themselves', () => {
  test('naturalCmp: 2 before 10, numbers before letters', () => {
    expect(naturalCmp('2', '10')).toBeLessThan(0)
    expect(naturalCmp('7', 'A')).toBeLessThan(0)
    expect(naturalCmp('A', 'B')).toBeLessThan(0)
  })

  test('naturalCmp: "7X" is a label, not the number seven', () => {
    // parseInt would call it 7 and sort it among the numbers
    expect(naturalCmp('7X', '10')).toBeGreaterThan(0)
  })

  test('lettersFirstCmp: letter groups outrank number groups', () => {
    expect(lettersFirstCmp('A', '1')).toBeLessThan(0)
    expect(lettersFirstCmp('1', 'A')).toBeGreaterThan(0)
    expect(lettersFirstCmp('1', '2')).toBeLessThan(0)
  })
})

describe('bullet stylization', () => {
  test('a yellow bullet gets dark glyphs, a dark one light', () => {
    expect(bulletTextColor('FCCC0A')).toBe('#111111') // MTA N/Q/R/W
    expect(bulletTextColor('0039A6')).toBe('#ffffff')
    expect(bulletLuma('ffffff')).toBeGreaterThan(160)
  })

  test('curated glyph colour outranks the luminance rule', () => {
    expect(bulletTextColor('FCCC0A', '#003300')).toBe('#003300')
    expect(bulletTextColor('FCCC0A', 'nonsense')).toBe('#111111')
  })

  test('an absent colour reads as portolan’s fallback grey', () => {
    expect(bulletHex(null)).toBe('888888')
    expect(bulletHex('#abc')).toBe('888888') // 3-digit is not a bullet hex
  })

  test('angular outlines are clipped, rectangular ones are radii', () => {
    const diamond = bulletGeometry('diamond', { compact: true, height: 22 })
    expect(diamond.clipPath).toContain('polygon')
    expect(diamond.minWidth).toBe('31px') // 22 × 1.42, the diamond's pad

    const square = bulletGeometry('square', { compact: true, height: 22 })
    expect(square.clipPath).toBeUndefined()
    expect(square.borderRadius).toBe('0')

    // Mexico City's house style: only the top-right corner is rounded,
    // at the baker's radius (6 of its 14px box) scaled to this one
    expect(bulletGeometry('notch', { compact: true, height: 22 }).borderRadius).toBe('0 9.4px 0 0')
  })

  test('a circle stays a circle for two glyphs and becomes a pill for a word', () => {
    expect(bulletGeometry('circle', { compact: true, height: 22 }).borderRadius).toBe('9999px')
    expect(bulletGeometry('circle', { compact: false, height: 22 }).borderRadius).toBe('5.5px')
  })

  test('a triangle is taller and drops its glyphs into the wide part', () => {
    const tri = bulletGeometry('triangle', { compact: true, height: 22 })
    expect(tri.height).toBe('25px')
    expect(tri.textShift).not.toBe('0px')
  })
})
