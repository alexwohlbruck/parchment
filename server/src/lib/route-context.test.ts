import { describe, expect, test } from 'bun:test'
import { foldRouteContext } from './route-context'
import type { RouteEdgeSegment } from '../types/unified-routing.types'

const edges: RouteEdgeSegment[] = [
  { startDistance: 0, endDistance: 100, roadClass: 'motorway' },
  { startDistance: 100, endDistance: 300, roadClass: 'motorway' },
]

describe('foldRouteContext', () => {
  test('splits edges at a state border and names each side', () => {
    const folded = foldRouteContext(edges, {
      states: [
        { startDistance: 0, endDistance: 180, name: 'New York' },
        { startDistance: 180, endDistance: 300, name: 'New Jersey' },
      ],
    })!
    expect(folded.map(e => [e.startDistance, e.endDistance, e.state])).toEqual([
      [0, 100, 'New York'],
      [100, 180, 'New York'],
      [180, 300, 'New Jersey'],
    ])
  })

  test('marks the stretch beneath an overpass, keeping the edge\'s own attributes', () => {
    const folded = foldRouteContext(edges, { overpasses: [{ distance: 150, endDistance: 170, kind: 'rail' }] })!
    expect(folded.filter(e => e.overpass).map(e => [e.startDistance, e.endDistance, e.overpass, e.roadClass])).toEqual([[145, 175, 'rail', 'motorway']])
    expect(folded.at(-1)).toEqual({ startDistance: 175, endDistance: 300, roadClass: 'motorway' })
  })

  test('marks parks, named or not', () => {
    const folded = foldRouteContext(edges, {
      parks: [{ startDistance: 0, endDistance: 50, name: 'Freedom Park' }, { startDistance: 200, endDistance: 300 }],
    })!
    expect(folded.filter(e => e.inPark).map(e => [e.startDistance, e.parkName])).toEqual([[0, 'Freedom Park'], [200, undefined]])
  })

  test('leaves edges alone without context, as from an older barrelman', () => {
    expect(foldRouteContext(edges, {})).toBe(edges)
  })
})
