import { describe, test, expect } from 'vitest'
import { buildMapStyle } from '@/lib/map-style/build'
import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { flatBridgeLabelFilter, flatBridgeOpacity } from './flat-bridges'
import { mercator } from './decks'
import { deckFootprints } from './footprints'

describe('flatBridgeOpacity', () => {
  const layers = buildMapStyle({ tileServerUrl: 'https://example.test/tiles', theme: 'light', hdRoads: true } as any).layers as any[]
  const muted = (id: string) => {
    const layer = layers.find(l => l.id === id)
    expect(layer, id).toBeDefined()
    return flatBridgeOpacity(layer)
  }

  test('mutes every flat copy of a bridge, its area included', () => {
    expect(muted('Bridge')).toBe('fill-opacity')
    expect(muted('Bridge area outline')).toBe('line-opacity')
    expect(muted('Major road bridge')).toBe('line-opacity')
    expect(muted('Road surface bridge')).toBe('fill-opacity')
    expect(muted('Road glyph bridge')).toBe('icon-opacity')
  })

  test('leaves what runs under a bridge alone', () => {
    for (const id of ['Major road', 'Highway', 'Road surface', 'Road glyph']) expect(muted(id), id).toBeNull()
  })

  test('takes road names and arrows off the decks, and only those', () => {
    const labels = layers.find(l => l.id === 'Road labels')
    const deck = deckFootprints([{ points: [mercator([-74, 40.7]), mercator([-73.999, 40.7])], edges: [5, 5] }])
    const filter = flatBridgeLabelFilter(labels, deck)!
    const style = { version: 8, sources: { openmaptiles: { type: 'vector', tiles: ['https://x/{z}/{x}/{y}'] } }, layers: [{ ...labels, filter }] }
    expect(validateStyleMin(style as any)).toEqual([])
    const z = 16
    const [tx, ty] = mercator([-73.9995, 40.7]).map(v => Math.floor(v * 2 ** z))
    const at = (lng: number, lat: number) => {
      const [x, y] = mercator([lng, lat])
      return { x: (x * 2 ** z - tx) * 8192, y: (y * 2 ** z - ty) * 8192 }
    }
    const shows = (lat: number, brunnel?: string) => featureFilter(filter, 'layers[0].filter').filter({ zoom: 18 } as any,
      { type: 2, properties: { class: 'primary', name: 'Brooklyn Bridge', ...(brunnel ? { brunnel } : {}) }, geometry: [[at(-73.9998, lat), at(-73.9992, lat)]] } as any, { z, x: tx, y: ty } as any)
    expect(shows(40.7)).toBe(false)
    expect(shows(40.701, 'bridge')).toBe(false)
    expect(shows(40.701)).toBe(true)
    for (const id of ['Oneway', 'Highway shield']) expect(flatBridgeLabelFilter(layers.find(l => l.id === id), deck), id).not.toBeNull()
    expect(flatBridgeLabelFilter(layers.find(l => l.id === 'Road glyph'), deck)).toBeNull()
  })
})
