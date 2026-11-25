import { describe, test, expect } from 'vitest'
import { Color, expression, featureFilter, latest } from '@maplibre/maplibre-gl-style-spec'
import { registerForkSpec } from './test-fork-spec'
import { buildLayers, buildMapStyle } from './build'
import { fuseLayers, fuseRoadRungs, fusedRoadId } from './fused-roads'

registerForkSpec()

const CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path', 'rail']
const FEATURES = CLASSES.flatMap(cls => [undefined, 'bridge', 'tunnel'].flatMap(brunnel => [0, 1].map(ramp => ({
  type: 2,
  properties: { class: cls, ramp, ...(brunnel ? { brunnel } : {}), bicycle: 'designated', highway: cls },
}))))
const ZOOMS = Array.from({ length: 33 }, (_, i) => 4 + i / 2)

const parsed = new Map<string, any>()
const evaluate = (layer: any, block: 'paint' | 'layout', key: string, zoom: number, feature: any) => {
  const spec = (latest as any)[`${block}_${layer.type}`][key]
  const value = layer[block]?.[key] ?? spec.default
  const settled = (out: unknown) => {
    const color = spec.type === 'color' && typeof out === 'string' ? Color.parse(out) : out
    return typeof color === 'object' && color !== null ? JSON.stringify(color) : color
  }
  if (!Array.isArray(value)) return settled(value)
  const cacheKey = JSON.stringify(value)
  if (!parsed.has(cacheKey)) {
    const result = expression.createPropertyExpression(value, key, spec)
    if (result.result !== 'success') throw new Error(`${layer.id} ${key}: ${JSON.stringify(result.value)}`)
    parsed.set(cacheKey, result.value)
  }
  return settled(parsed.get(cacheKey).evaluate({ zoom } as any, feature))
}

const filters = new Map<string, ReturnType<typeof featureFilter>>()
const takes = (layer: any, zoom: number, feature: any) => {
  const key = JSON.stringify(layer.filter)
  if (!filters.has(key)) filters.set(key, featureFilter(layer.filter, `${layer.id}.filter`))
  return filters.get(key)!.filter({ zoom } as any, feature)
}

describe.each([
  ['light', false],
  ['dark', false],
  ['light', true],
] as const)('%s roads, HD %s', (flavor, hdRoads) => {
  const plain = buildLayers({ flavor, hdRoads }) as any[]
  const fused = fuseRoadRungs(plain)

  test('leaves no rung of its own', () => {
    const left = fused.filter(l => fusedRoadId(l.id) !== l.id).map(l => l.id)
    expect(left).toEqual([])
    expect(new Set(plain.map(l => fusedRoadId(l.id))).size).toBe(fused.length)
  })

  const fusedLayers = fused.filter(l => plain.every(p => p.id !== l.id))
  const membersOf = (layer: any) => plain.filter(p => fusedRoadId(p.id) === layer.id)

  test('paints every way as the topmost rung drawing it did, and stacks the rungs in their order', { timeout: 60000 }, () => {
    for (const layer of fusedLayers) {
      const members = membersOf(layer)
      for (const feature of FEATURES) {
        for (const zoom of ZOOMS) {
          const rank = members.findLastIndex(m => takes(m, zoom, feature))
          expect(takes(layer, zoom, feature), `${layer.id} ${JSON.stringify(feature.properties)}`).toBe(rank >= 0)
          if (rank < 0) continue
          const member = members[rank]
          for (const block of ['paint', 'layout'] as const) {
            for (const key of Object.keys(member[block] ?? {})) {
              const want = evaluate(member, block, key, zoom, feature)
              const got = evaluate(layer, block, key, zoom, feature)
              const where = `${member.id} ${key} z${zoom} ${feature.properties.class}`
              if (typeof want === 'number') expect(got, where).toBeCloseTo(want, 6)
              else expect(got, where).toEqual(want)
            }
          }
          expect(evaluate(layer, 'layout', 'line-sort-key', zoom, feature)).toBe(rank)
        }
      }
    }
  })

  /** `Minor road` takes trunks as well as `Major road` does; the one beneath edges out by at most half a pixel a side. */
  test('hides no more than a sub-pixel fringe a lower rung showed around the way', () => {
    const peeking: string[] = []
    for (const layer of fusedLayers) {
      const members = membersOf(layer)
      for (const feature of FEATURES) {
        for (const zoom of ZOOMS) {
          const drawing = members.filter(m => takes(m, zoom, feature))
          const top = drawing.pop()
          if (!top) continue
          const width = (m: any) => evaluate(m, 'paint', 'line-width', zoom, feature) as number
          for (const below of drawing) {
            if (width(below) > width(top) + 1) peeking.push(`${below.id} under ${top.id} z${zoom} ${feature.properties.class}: ${width(below).toFixed(2)} > ${width(top).toFixed(2)}`)
          }
        }
      }
    }
    expect([...new Set(peeking)]).toEqual([])
  })
})

describe('fuseLayers', () => {
  const line = (id: string, cls: string, layout: Record<string, unknown> = {}) => ({
    id, type: 'line', source: 's', 'source-layer': 'transportation',
    filter: ['==', ['get', 'class'], cls], layout, paint: { 'line-width': 2 },
  })

  test('keeps layers apart that differ in what a feature cannot vary', () => {
    const anchored = (id: string, cls: string, anchor: string) => ({ ...line(id, cls), paint: { 'line-width': 2, 'line-translate-anchor': anchor } })
    expect(fuseLayers('Road', [anchored('a', 'minor', 'map'), anchored('b', 'primary', 'viewport')])).toBeNull()
  })

  test('keeps layers apart that draw from different zooms', () => {
    expect(fuseLayers('Road', [{ ...line('a', 'minor'), minzoom: 10 }, line('b', 'primary')])).toBeNull()
  })
})

test('the shipped style draws each road part once', () => {
  const ids = buildMapStyle({ tileServerUrl: 'https://example.test/tiles', theme: 'light' } as any).layers.map(l => l.id)
  for (const id of ['Road outline', 'Road', 'Road outline bridge', 'Road bridge']) expect(ids).toContain(id)
  expect(ids).not.toContain('Minor road')
})
