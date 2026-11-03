import { describe, expect, test } from 'vitest'
import { FLIGHT_RISE } from '@/lib/indoor/indoor-sizes.mjs'
import { EXTERIOR_LEVEL } from '@/lib/map-style/indoor-layers'
import { flightInstance, INDOOR_FLIGHT_MODELS, INDOOR_FLIGHT_PALETTE } from './indoor-flights'
import { OBJECT_MODELS } from './index'

const flight = (props: Record<string, unknown> = {}) => ({
  kind: 'flight', class: 'escalator', venue: 7, level: 0, default_level: 0, width: 1.2, length: 9, bearing: 90, ...props,
})

describe('flightInstance', () => {
  test('stretches the model to the flight and tilts it uphill by a storey', () => {
    const instance = flightInstance(flight(), -73.9, 40.7, { venue: 7, level: 0 })!
    expect(instance).toMatchObject({ model: 'escalator', width: 1.2, length: 9, rise: FLIGHT_RISE })
    expect(Math.cos(instance.heading)).toBeCloseTo(1)
    expect(flightInstance(flight({ class: 'steps', bearing: 0 }), 0, 0, { venue: 7, level: 0 })).toMatchObject({
      model: 'stairs',
      heading: -Math.PI / 2,
    })
  })

  test('stands only on the floor its venue shows', () => {
    expect(flightInstance(flight({ level: 1 }), 0, 0, { venue: 7, level: 0 })).toBeNull()
    expect(flightInstance(flight({ level: 1 }), 0, 0, { venue: 7, level: 1 })).not.toBeNull()
    expect(flightInstance(flight({ venue: 3 }), 0, 0, { venue: 7, level: 1 })).not.toBeNull()
    expect(flightInstance(flight({ venue: 3, level: -1, default_level: -1 }), 0, 0, { venue: 0, level: EXTERIOR_LEVEL })).toBeNull()
  })

  test('leaves out everything that is not a measured flight', () => {
    expect(flightInstance(flight({ kind: 'line' }), 0, 0, { venue: 7, level: 0 })).toBeNull()
    expect(flightInstance(flight({ length: 0 }), 0, 0, { venue: 7, level: 0 })).toBeNull()
  })
})

describe('flight models', () => {
  test('load on their own layer, not with the 3D objects', () => {
    expect(Object.keys(INDOOR_FLIGHT_MODELS).sort()).toEqual(['escalator', 'escalator-far', 'stairs', 'stairs-far'])
    for (const name of Object.keys(INDOOR_FLIGHT_MODELS)) expect(OBJECT_MODELS).not.toHaveProperty(name)
  })

  test('both flavors colour every role', () => {
    expect(Object.keys(INDOOR_FLIGHT_PALETTE.dark).sort()).toEqual(Object.keys(INDOOR_FLIGHT_PALETTE.light).sort())
  })
})
