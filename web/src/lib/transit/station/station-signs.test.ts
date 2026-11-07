import { describe, expect, it } from 'vitest'
import { boardingSign, stationSign, type SignedSegment } from './station-signs'
import type { StationWalk } from '@server/types/station-guidance.types'

const walk = { seconds: 90, estimate: true } as StationWalk
const ride = (extra: Partial<SignedSegment> = {}): SignedSegment => ({ mode: 'transit', routeType: 'subway', lineName: '3', ...extra })

describe('stationSign', () => {
  it('points an entrance at the line and the direction it is signed for', () => {
    const segments = [{ mode: 'walking' }, ride({ directionLabel: 'Manhattan', headsign: 'Harlem-148 St' })]
    expect(stationSign(segments, { kind: 'access', walk, ride: 1 })).toEqual({ kind: 'platform', line: '3', toward: 'Manhattan' })
  })

  it('falls back to the headsign without a signed direction', () => {
    expect(stationSign([ride({ headsign: 'Harlem-148 St' })], { kind: 'access', walk, ride: 0 })).toMatchObject({ toward: 'Harlem-148 St' })
  })

  it('points to the exit leaving the station', () => {
    expect(stationSign([ride()], { kind: 'egress', walk, ride: 0 })).toEqual({ kind: 'exit' })
  })

  it('has nothing to follow across the platform', () => {
    const segments = [ride(), ride({ lineName: '2', transfer: { class: 'same_platform' } as SignedSegment['transfer'] })]
    expect(stationSign(segments, { kind: 'transfer', walk, ride: 1 })).toBeNull()
  })

  it('gives the street walk into a station the entrance signs', () => {
    const entrance = { walk } as SignedSegment['entrance']
    const segments = [{ mode: 'walking' }, ride({ entrance, directionLabel: 'Manhattan' })]
    expect(boardingSign(segments, 0)).toEqual({ kind: 'platform', line: '3', toward: 'Manhattan' })
    expect(boardingSign([{ mode: 'walking' }, ride()], 0)).toBeNull()
  })
})
