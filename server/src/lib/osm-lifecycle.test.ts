/**
 * OSM lifecycle-prefix detection.
 *
 * The failure this guards against is silent and user-visible: a cafe tagged
 * `disused:amenity=cafe` keeps the `opening_hours` it had when it was trading,
 * so anything that misses the prefix evaluates those hours and tells people the
 * place is "Open now" (PAR-287).
 *
 * The other direction matters just as much. `demolished:date` and `was:name`
 * record a *live* feature's history, so matching on the prefix alone would
 * close places that are open for business.
 */

import { describe, test, expect } from 'bun:test'
import { isPermanentlyClosedByOsmTags } from './osm-lifecycle'

describe('isPermanentlyClosedByOsmTags', () => {
  describe('lifecycle-prefixed primary tags', () => {
    test.each([
      ['disused:amenity', 'cafe'],
      ['abandoned:shop', 'bakery'],
      ['demolished:building', 'yes'],
      ['razed:leisure', 'fitness_centre'],
      ['was:tourism', 'hotel'],
      ['removed:office', 'company'],
      ['destroyed:historic', 'monument'],
      ['abandoned:railway', 'rail'],
      ['disused:public_transport', 'station'],
      ['disused:healthcare', 'pharmacy'],
    ])('%s=%s is permanently closed', (key, value) => {
      expect(isPermanentlyClosedByOsmTags({ [key]: value })).toBe(true)
    })

    test('closes the place even alongside live hours', () => {
      // The exact shape from PAR-287: stale hours on a retired cafe.
      expect(
        isPermanentlyClosedByOsmTags({
          'disused:amenity': 'cafe',
          opening_hours: 'Mo-Fr 09:00-17:00',
          name: 'Old Cafe',
        }),
      ).toBe(true)
    })
  })

  describe('boolean form', () => {
    test.each(['disused', 'abandoned', 'demolished', 'razed', 'was'])(
      '%s=yes is permanently closed',
      key => {
        expect(isPermanentlyClosedByOsmTags({ [key]: 'yes' })).toBe(true)
      },
    )

    test.each(['no', 'false', ''])('disused=%s is not closed', value => {
      expect(isPermanentlyClosedByOsmTags({ disused: value })).toBe(false)
    })
  })

  describe('prefixes qualifying something other than the primary tag', () => {
    test.each([
      ['demolished:date', '2019'],
      ['was:name', 'Old Cafe'],
      ['disused:opening_hours', 'Mo-Fr 09:00-17:00'],
      ['abandoned:description', 'former mill'],
      ['razed:note', 'see history'],
    ])('%s=%s leaves the place open', (key, value) => {
      expect(
        isPermanentlyClosedByOsmTags({ amenity: 'cafe', [key]: value }),
      ).toBe(false)
    })
  })

  describe('live places', () => {
    test('a plain cafe is not closed', () => {
      expect(
        isPermanentlyClosedByOsmTags({
          amenity: 'cafe',
          name: 'Corner Cafe',
          opening_hours: 'Mo-Fr 09:00-17:00',
        }),
      ).toBe(false)
    })

    test('a historic feature is not a lifecycle prefix', () => {
      // `historic=memorial` shares no ground with `destroyed:historic`.
      expect(isPermanentlyClosedByOsmTags({ historic: 'memorial' })).toBe(false)
    })

    test.each([[undefined], [null], [{}]])('%p is not closed', tags => {
      expect(isPermanentlyClosedByOsmTags(tags as any)).toBe(false)
    })
  })
})
