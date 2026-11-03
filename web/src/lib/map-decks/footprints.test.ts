import { describe, expect, test } from 'vitest'
import { featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { mercator } from './decks'
import { deckFootprints } from './footprints'

describe('deckFootprints', () => {
  const deck = { points: [mercator([-74, 40.7]), mercator([-73.999, 40.7])], edges: [6, 4] }
  const footprint = deckFootprints([deck])

  test('reaches past the widest edge and both ends', () => {
    const ring = footprint.coordinates[0][0]
    const lats = ring.map(p => p[1])
    const lngs = ring.map(p => p[0])
    const metres = (deg: number) => deg * 111_320
    expect(metres(Math.max(...lats) - 40.7)).toBeCloseTo(8, 0)
    expect(metres(40.7 - Math.min(...lats))).toBeCloseTo(8, 0)
    expect(Math.min(...lngs)).toBeLessThan(-74)
    expect(Math.max(...lngs)).toBeGreaterThan(-73.999)
  })

  test('holds a way along the deck and not one leaving it', () => {
    const within = featureFilter(['within', { type: 'Feature', geometry: footprint, properties: {} }] as any, 'layers[0].filter')
    const z = 16
    const [tx, ty] = mercator([-73.9995, 40.7]).map(v => Math.floor(v * 2 ** z))
    const tile = (lng: number, lat: number) => {
      const [x, y] = mercator([lng, lat])
      return { x: (x * 2 ** z - tx) * 8192, y: (y * 2 ** z - ty) * 8192 }
    }
    const line = (...pts: number[][]) => ({ type: 2, properties: {}, geometry: [pts.map(([lng, lat]) => tile(lng, lat))] }) as any
    const canonical = { z, x: tx, y: ty } as any
    expect(within.filter({ zoom: z } as any, line([-74, 40.7], [-73.999, 40.70001]), canonical)).toBe(true)
    expect(within.filter({ zoom: z } as any, line([-74, 40.7], [-73.999, 40.7003]), canonical)).toBe(false)
  })
})
