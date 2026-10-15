import { describe, expect, test } from 'vitest'
import { golfFlagInstance, GOLF_OBJECTS } from './golf'
import { golfPinMaxzoom, GOLF_FLAG_MINZOOM } from '@/lib/map-style/detail-layers'

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
    expect(golfPinMaxzoom(true)).toBe(GOLF_OBJECTS.minzoom)
    expect(golfPinMaxzoom(false)).toBeGreaterThan(GOLF_OBJECTS.minzoom)
  })
})
