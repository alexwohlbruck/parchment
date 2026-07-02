import { describe, expect, test } from 'vitest'
import {
  TRANSIT_MODES,
  getTransitMode,
  getTransitModeLayers,
  isTransitModeLayer,
  isTransitModeVisible,
  type TransitMode,
} from './transit.utils'

/**
 * Guards the mode->layers mapping behind the transit rail/bus/ferry filter:
 * a mode toggle must flip exactly the transit layers tagged with that mode
 * via `configuration.metadata.transitMode` (see
 * server/src/constants/default-layers/transit.ts and
 * docs/par-12-client-render.md).
 */

const layer = (
  id: string,
  mode?: TransitMode,
  { type = 'transit', visible = true }: { type?: string; visible?: boolean } = {},
) => ({
  id,
  type,
  visible,
  configuration: {
    id,
    metadata: mode
      ? ({ transitRole: 'routes', transitMode: mode } as const)
      : {},
  },
})

const LAYERS = [
  layer('transit-lines-steady', 'rail'),
  layer('transit-routes-hover', 'rail'),
  layer('transit-lines-bullets', 'rail', { visible: false }),
  layer('transit-routes-bus', 'bus'),
  layer('transit-stops-bus', 'bus'),
  layer('transit-routes-ferry', 'ferry'),
  // Untagged transit layer: master toggle only, no mode chip owns it.
  layer('transitland', undefined),
  // Non-transit layer that happens to carry the metadata — must be ignored.
  layer('cycleways', 'rail', { type: 'custom' }),
]

describe('transit mode metadata', () => {
  test('exposes the three filter modes in chip order', () => {
    expect(TRANSIT_MODES).toEqual(['rail', 'bus', 'ferry'])
  })

  test('getTransitMode reads configuration metadata', () => {
    expect(getTransitMode(LAYERS[0].configuration)).toBe('rail')
    expect(getTransitMode(LAYERS[6].configuration)).toBeUndefined()
    expect(getTransitMode(null)).toBeUndefined()
  })
})

describe('mode -> layers mapping', () => {
  test('a mode owns exactly its tagged transit layers', () => {
    expect(getTransitModeLayers(LAYERS, 'rail').map(l => l.id)).toEqual([
      'transit-lines-steady',
      'transit-routes-hover',
      'transit-lines-bullets',
    ])
    expect(getTransitModeLayers(LAYERS, 'bus').map(l => l.id)).toEqual([
      'transit-routes-bus',
      'transit-stops-bus',
    ])
    expect(getTransitModeLayers(LAYERS, 'ferry').map(l => l.id)).toEqual([
      'transit-routes-ferry',
    ])
  })

  test('untagged and non-transit layers belong to no mode', () => {
    for (const mode of TRANSIT_MODES) {
      expect(isTransitModeLayer(LAYERS[6], mode)).toBe(false) // untagged
      expect(isTransitModeLayer(LAYERS[7], mode)).toBe(false) // type!=transit
    }
    expect(isTransitModeLayer(undefined, 'rail')).toBe(false)
  })

  test('every mapped layer belongs to exactly one mode', () => {
    for (const l of LAYERS) {
      const owners = TRANSIT_MODES.filter(mode => isTransitModeLayer(l, mode))
      expect(owners.length).toBeLessThanOrEqual(1)
    }
  })
})

describe('derived mode visibility (chip state)', () => {
  test('a mode is on when ANY of its layers is visible', () => {
    // Rail: bullets are individually disabled by default, but the ribbons are
    // visible — the chip must still read on.
    expect(isTransitModeVisible(LAYERS, 'rail')).toBe(true)
  })

  test('a mode is off when all of its layers are hidden', () => {
    const allOff = LAYERS.map(l =>
      getTransitMode(l.configuration) === 'bus' ? { ...l, visible: false } : l,
    )
    expect(isTransitModeVisible(allOff, 'bus')).toBe(false)
    expect(isTransitModeVisible(allOff, 'ferry')).toBe(true) // untouched
  })

  test('a mode with no layers present reads off', () => {
    expect(isTransitModeVisible([], 'ferry')).toBe(false)
  })
})
