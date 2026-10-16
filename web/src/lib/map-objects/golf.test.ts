import { describe, expect, test } from 'vitest'
import { golfFlagInstance, GOLF_OBJECTS } from './golf'
import { golfFlagStanding, golfPinOpacity, GOLF_FLAG_MINZOOM, GOLF_FLAG_MIN_PITCH } from '@/lib/map-style/detail-layers'
import { expression, latest } from '@maplibre/maplibre-gl-style-spec'

describe('golf flags', () => {
  test('only pins get a flagstick', () => {
    expect(golfFlagInstance({ id: 1, properties: { kind: 'green' } }, 0, 0)).toBeNull()
    expect(golfFlagInstance({ id: 1, properties: { kind: 'pin' } }, 0, 0)?.model).toBe('golf-flag')
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
})
