import { describe, expect, test } from 'vitest'
import { buildNavRoute } from './nav-route'
import { roadLabel, stepRoad } from './guidance-display'
import { polyline } from './test-routes'

// 200 m along a sidewalk that is West 23rd Street's for 80 m and East 23rd Street's after.
const geometry = polyline([[90, 200]])
const sidewalk = (instructionName?: string) =>
  buildNavRoute([
    {
      mode: 'walking',
      geometry,
      instructions: [
        { type: 'depart', text: '', distance: 200, duration: 150, streetName: instructionName, coordinate: geometry[0] },
        { type: 'destination', text: '', distance: 0, duration: 0, coordinate: geometry.at(-1)! },
      ],
      edgeSegments: [
        { startDistance: 0, endDistance: 80, roadClass: 'footway', streetName: 'West 23rd Street', streetNameSource: 'geometry' },
        { startDistance: 80, endDistance: 95, roadClass: 'footway' },
        { startDistance: 95, endDistance: 200, roadClass: 'footway', streetName: 'East 23rd Street', streetNameSource: 'geometry' },
      ],
    } as never,
  ])

describe('roadLabel', () => {
  test('follows the street beside the sidewalk as it changes mid-step', () => {
    const route = sidewalk('East 23rd Street')
    expect(roadLabel(route, 40)).toEqual({ kind: 'named', name: 'West 23rd Street' })
    expect(roadLabel(route, 150)).toEqual({ kind: 'named', name: 'East 23rd Street' })
  })

  test('keeps the step’s street across a crossing between sidewalks', () => {
    expect(roadLabel(sidewalk('East 23rd Street'), 88)).toEqual({ kind: 'named', name: 'East 23rd Street' })
  })

  test('falls back to the kind of way where nothing names it', () => {
    expect(roadLabel(sidewalk(), 88)).toEqual({ kind: 'generic', key: 'path' })
  })
})

test('stepRoad names an unnamed step from the sidewalk under it', () => {
  const route = sidewalk()
  expect(stepRoad(route, route.steps[0], 150)).toEqual({ kind: 'named', name: 'East 23rd Street' })
})

describe('unnamed ways', () => {
  const route = (edge: Record<string, unknown>) =>
    buildNavRoute([
      {
        mode: 'walking',
        geometry,
        instructions: [
          { type: 'depart', text: '', distance: 200, duration: 150, coordinate: geometry[0] },
          { type: 'destination', text: '', distance: 0, duration: 0, coordinate: geometry.at(-1)! },
        ],
        edgeSegments: [{ startDistance: 0, endDistance: 200, ...edge }],
      } as never,
    ])
  const label = (edge: Record<string, unknown>) => roadLabel(route(edge), 100)

  test('name a crosswalk, a railroad crossing, a footbridge, an underpass and a park path', () => {
    expect(label({ roadClass: 'footway', crossing: 'MARKED' })).toEqual({ kind: 'generic', key: 'crosswalk' })
    expect(label({ roadClass: 'footway', crossing: 'RAILWAY_BARRIER' })).toEqual({ kind: 'generic', key: 'railCrossing' })
    expect(label({ roadClass: 'footway', roadEnvironment: 'bridge' })).toEqual({ kind: 'generic', key: 'footbridge' })
    expect(label({ roadClass: 'path', roadEnvironment: 'tunnel' })).toEqual({ kind: 'generic', key: 'underpass' })
    expect(label({ roadClass: 'path', inPark: true })).toEqual({ kind: 'generic', key: 'parkPath' })
  })

  test('fall back to the class where the way is nothing more specific', () => {
    expect(label({ roadClass: 'footway', crossing: 'MISSING' })).toEqual({ kind: 'generic', key: 'path' })
    expect(label({ roadClass: 'cycleway', roadEnvironment: 'bridge' })).toEqual({ kind: 'generic', key: 'cycleway' })
  })
})
