/**
 * Which OSM object a GTFS stop is.
 *
 * The reason this index exists at all: a name cannot tell three stations
 * called "Chambers St" apart, and distance is worse — the nearest mapped node
 * to the J/Z platform belongs to Brooklyn Bridge–City Hall, across the
 * passageway. Only portolan's own join is exact.
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { osmForStop, resetPortolanStops, setPortolanStopIndex } from './portolan-stops'
import { resetPortolanBullets } from './portolan-bullets'

const NYC = { feed: 'nyc-subway', bounds: [-74.3, 40.5, -73.6, 40.95], maxzoom: 16 }

describe('osmForStop', () => {
  beforeEach(() => {
    resetPortolanStops()
    resetPortolanBullets([NYC])
    setPortolanStopIndex('nyc-subway', {
      'f-dr5r-nyctsubway:M21': 'node/2052618392',
      'f-dr5r-nyctsubway:A36': 'node/7218038804',
      'f-dr5r-nyctsubway:640': 'node/8410411844',
    })
  })

  test('tells two stations of the same name apart', () => {
    // Both are "Chambers St"; only the stop id separates them.
    expect(osmForStop('f-dr5r-nyctsubway', 'M21', 40.7132, -74.0034)).toBe('node/2052618392')
    expect(osmForStop('f-dr5r-nyctsubway', 'A36', 40.7141, -74.0086)).toBe('node/7218038804')
  })

  test('is null for a stop the pyramid never matched', () => {
    expect(osmForStop('f-rioc~nyc', '2437315', 40.76, -73.95)).toBeNull()
  })

  test('is null without both halves of the key', () => {
    expect(osmForStop(undefined, 'M21', 40.71, -74)).toBeNull()
    expect(osmForStop('f-dr5r-nyctsubway', undefined, 40.71, -74)).toBeNull()
  })

  test('a feed with no published index resolves nothing rather than throwing', () => {
    setPortolanStopIndex('nyc-subway', null)

    expect(osmForStop('f-dr5r-nyctsubway', 'M21', 40.7132, -74.0034)).toBeNull()
  })
})
