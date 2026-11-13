import { describe, expect, test } from 'vitest'
import { mercator, type Chain, type DeckSurface } from './decks'
import { roofCuts } from './roofs'

describe('roofCuts', () => {
  const points = [mercator([-74, 40.7]), mercator([-73.999, 40.7])]
  const chain: Chain = { points, grounded: [true, true], layer: 1, width: 8, kind: 'road', edges: [5, 3] }
  const surface = (extra: Partial<DeckSurface>) => ({ points, z: [15, 14], d: [0, 84], width: 9, ground: [13, 12], ...extra }) as DeckSurface

  test('carves the ground down to a roofed deck\'s own, under its width', () => {
    const [cut] = [...roofCuts([{ chain, surface: surface({ roofed: true }) }]).values()]
    expect(cut.fill).toBe(false)
    expect(cut.floor).toEqual([13, 12])
    expect(cut.inner[0]).toBeGreaterThan(5)
    expect(cut.inner[1]).toBeGreaterThan(3)
  })

  test('leaves an open deck, and one without its ground, alone', () => {
    expect(roofCuts([{ chain, surface: surface({}) }]).size).toBe(0)
    expect(roofCuts([{ chain, surface: surface({ roofed: true, ground: undefined }) }]).size).toBe(0)
  })
})
