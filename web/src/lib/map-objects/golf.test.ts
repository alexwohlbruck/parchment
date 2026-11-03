import { describe, expect, test } from 'vitest'
import { golfFlagInstance, golfPinSites, GOLF_OBJECTS } from './golf'
import { golfFlagStanding, golfPinOpacity, GOLF_FLAG_MINZOOM, GOLF_FLAG_MIN_PITCH } from '@/lib/map-style/detail-layers'
import { expression, latest } from '@maplibre/maplibre-gl-style-spec'

describe('golf flags', () => {
  test('pins and greens get a flagstick, other golf features none', () => {
    expect(golfFlagInstance({ id: 1, properties: { kind: 'bunker' } }, 0, 0)).toBeNull()
    expect(golfFlagInstance({ id: 1, properties: { kind: 'pin' } }, 0, 0)?.model).toBe('golf-flag')
    expect(golfFlagInstance({ id: 1, properties: { kind: 'green' } }, 0, 0)?.model).toBe('golf-flag')
  })

  test('a pin keeps its heading from tile to tile', () => {
    const a = golfFlagInstance({ id: 42, properties: { kind: 'pin' } }, 1, 2)
    const b = golfFlagInstance({ id: 42, properties: { kind: 'pin' } }, 1, 2)
    expect(a?.heading).toBe(b?.heading)
  })

  test('the flat pin hides exactly where the 3D flag starts', () => {
    expect(GOLF_OBJECTS.minzoom).toBe(GOLF_FLAG_MINZOOM)
    const at = (value: any, zoom: number) =>
      (expression.createPropertyExpression(value, 'pin.icon-opacity', (latest as any).paint_symbol['icon-opacity']) as any)
        .value.evaluate({ zoom })
    const pitched = golfPinOpacity(true)
    expect(at(pitched, GOLF_FLAG_MINZOOM - 0.01)).toBe(1)
    expect(at(pitched, GOLF_FLAG_MINZOOM)).toBe(0)
    expect(at(golfPinOpacity(false), 20)).toBe(1)
    expect(golfFlagStanding(true, GOLF_FLAG_MIN_PITCH)).toBe(true)
    expect(golfFlagStanding(true, 0)).toBe(false)
    expect(golfFlagStanding(false, 60)).toBe(false)
  })

  describe('flag sites', () => {
    const square = (w: number, s: number, e: number, n: number) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]]
    const green = (id: number, coordinates: any) => ({ id, properties: { kind: 'green' }, geometry: { type: 'Polygon', coordinates } })
    const pin = (id: number, coordinates: [number, number]) => ({ id, properties: { kind: 'pin' }, geometry: { type: 'Point', coordinates } })

    test('a green without a mapped pin gets a flag in its middle', () => {
      expect(golfPinSites([green(1, square(0, 0, 2, 2))])).toEqual([{ key: 'green:1', lng: 1, lat: 1 }])
    })

    test('a mapped pin stands in for its green', () => {
      const sites = golfPinSites([green(1, square(0, 0, 2, 2)), pin(9, [0.5, 0.5]), green(2, square(5, 5, 6, 6))])
      expect(sites.map(s => s.key).sort()).toEqual(['green:2', 'pin:9'])
    })

    test("a green split across tiles gets one flag, in the whole green's middle", () => {
      const sites = golfPinSites([green(1, square(0, 0, 1.2, 2)), green(1, square(0.8, 0, 4, 2))])
      expect(sites).toEqual([{ key: 'green:1', lng: 2, lat: 1 }])
    })

    test('a curved green keeps its flag on the grass', () => {
      const horseshoe = [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]]
      expect(golfPinSites([green(1, horseshoe)])).toEqual([{ key: 'green:1', lng: 0.5, lat: 1.5 }])
    })
  })
})
