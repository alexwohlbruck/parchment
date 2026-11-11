import { expect, test } from 'vitest'
import { legHeadsUp } from './leg-heads-up'
import type { RouteHazard } from '@/types/directions.types'

const at = { lat: 0, lng: 0 }
const hazard = (kind: RouteHazard['kind'], startDistance: number, severity: RouteHazard['severity'] = 'high', endDistance?: number): RouteHazard =>
  ({ kind, severity, startDistance, coordinate: at, ...(endDistance != null && { endDistance }) })

test('keeps only what matters for the mode', () => {
  const hazards = [hazard('traffic_signals', 10), hazard('stop', 20), hazard('steps', 30), hazard('toll', 40)]
  expect(legHeadsUp({ mode: 'walking', hazards }).map(h => h.kind)).toEqual(['steps'])
  expect(legHeadsUp({ mode: 'driving', hazards }).map(h => h.kind)).toEqual(['toll'])
})

test('a short push across a curb cut is not worth a chip', () => {
  const hazards = [hazard('dismount', 100, 'high', 105), hazard('dismount', 400, 'high', 450)]
  expect(legHeadsUp({ mode: 'cycling', hazards })).toEqual([{ kind: 'dismount', at: 400, count: 1, severity: 'high' }])
})

test('one chip per kind, counted, most severe first', () => {
  const hazards = [hazard('rail_crossing', 50, 'medium'), hazard('steep_grade', 80, 'high', 200), hazard('rail_crossing', 300, 'medium')]
  expect(legHeadsUp({ mode: 'biking', hazards })).toEqual([
    { kind: 'steep_grade', at: 80, count: 1, severity: 'high' },
    { kind: 'rail_crossing', at: 50, count: 2, severity: 'medium' },
  ])
})
