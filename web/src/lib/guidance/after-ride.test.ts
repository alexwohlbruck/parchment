import { describe, expect, test } from 'vitest'
import type { StationAccessChoice, StationWalk, TransitTransfer } from '@server/types/station-guidance.types'
import { afterRide, type AfterRideSegment } from './after-ride'

const walk = { source: 'graph', estimate: false, seconds: 80 } as StationWalk
const exit: StationAccessChoice = {
  id: 'x', name: 'Exit 3', ref: null, cornerLabel: 'Atlantic Av & 4th Av · SE corner', lat: 0, lng: 0,
  streetSeconds: 120, stationSeconds: 80, totalSeconds: 200, walk,
}
const change: TransitTransfer = {
  class: 'in_station', surfaces: false, reentryFree: null, fareGateDelayS: 0, seconds: 150, source: 'graph', walk,
}
const n: AfterRideSegment = { mode: 'transit', routeType: 'subway', lineName: 'N', headsign: 'Coney Island', arrivalStop: { name: 'Atlantic Av' } }
const toDestination: AfterRideSegment = { mode: 'walking', duration: 240, end: { label: 'Barclays Center' } }

describe('afterRide', () => {
  test('the walk out names the destination and the exit to leave by', () => {
    expect(afterRide([n, toDestination], 0)).toEqual({ kind: 'walk', seconds: 240, to: 'Barclays Center', exit: undefined })
    expect(afterRide([{ ...n, exit }, toDestination], 0)).toMatchObject({ exit: 'Atlantic Av & 4th Av · SE corner' })
    expect(afterRide([{ ...n, exit: { ...exit, cornerLabel: null } }, toDestination], 0)).toMatchObject({ exit: 'Exit 3' })
  })

  test('a change names the next line by its platform sign, with the transfer when known', () => {
    const two: AfterRideSegment = { mode: 'transit', routeType: 'subway', lineName: '2', headsign: 'Flatbush Av', directionLabel: 'Brooklyn', lineColor: '#EE352E', transfer: change }
    expect(afterRide([n, { mode: 'walking', duration: 150 }, two], 0)).toEqual({
      kind: 'transfer',
      line: { name: '2', color: '#EE352E', textColor: undefined, toward: 'Brooklyn' },
      transfer: change,
      walkSec: null,
    })
    expect(afterRide([n, { ...two, transfer: undefined }], 0)).toMatchObject({ kind: 'transfer', transfer: null, line: { toward: 'Brooklyn' } })
  })

  test('without station data a change to a bus says how long the walk is', () => {
    const bus: AfterRideSegment = { mode: 'transit', routeType: 3, lineName: 'B63', headsign: 'Bay Ridge' }
    expect(afterRide([n, { mode: 'walking', duration: 180 }, bus], 0)).toMatchObject({ kind: 'transfer', transfer: null, walkSec: 180, line: { toward: 'Bay Ridge' } })
  })

  test('another mode, or nothing at all, after the ride', () => {
    expect(afterRide([n, { mode: 'cycling', duration: 600, end: { label: 'Home' } }], 0)).toEqual({ kind: 'travel', mode: 'cycling', seconds: 600, to: 'Home' })
    expect(afterRide([n], 0)).toEqual({ kind: 'arrive', to: 'Atlantic Av' })
    expect(afterRide([toDestination], 0)).toBeNull()
  })
})
