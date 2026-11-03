import { describe, expect, test } from 'bun:test'
import { needsOutlook, pointHazards, pointHazardsRequest, sunIsDown } from './route-point-hazards'
import type { RoutePointHazard } from '../types/unified-routing.types'

const segment = (mode = 'driving', country?: string) => ({
  mode,
  distance: 1000,
  geometry: [{ lat: 40.75, lng: -73.99 }, { lat: 40.76, lng: -73.99 }],
  edgeSegments: country ? [{ startDistance: 0, endDistance: 1000, country }] : [],
})
const found = (kind: string, detail?: string, endDistance?: number): RoutePointHazard => ({
  kind, distance: 100, coordinate: [-73.99, 40.751], osm: 'node/1', ...(detail && { detail }), ...(endDistance && { endDistance }),
})
/** 17:00 and 03:00 in New York on an October day. */
const day = new Date('2026-10-29T21:00:00Z')
const night = new Date('2026-10-29T07:00:00Z')
const dry = { start: day, outlook: { rain: false, minTemperature: 12 } }

describe('pointHazardsRequest', () => {
  test('profiles by mode, coordinates as [lng, lat]', () => {
    expect(pointHazardsRequest(segment('biking'))).toEqual({ profile: 'bike', coordinates: [[-73.99, 40.75], [-73.99, 40.76]] })
  })

  test('none for transit, or a segment past barrelman\'s length limit', () => {
    expect(pointHazardsRequest(segment('transit'))).toBeNull()
    expect(pointHazardsRequest({ ...segment(), distance: 400_000 })).toBeNull()
  })
})

describe('pointHazards', () => {
  test('stop signs and lights are placed as barrelman found them', () => {
    expect(pointHazards([found('stop')], segment(), dry)[0]).toMatchObject({ kind: 'stop', severity: 'medium', startDistance: 100, coordinate: { lat: 40.751, lng: -73.99 } })
  })

  test('an unlit path matters only once the sun is down there', () => {
    expect(pointHazards([found('unlit', undefined, 300)], segment('walking'), dry)).toEqual([])
    expect(pointHazards([found('unlit', undefined, 300)], segment('walking'), { ...dry, start: night })[0]).toMatchObject({ kind: 'unlit', endDistance: 300 })
  })

  test('the hour at a hazard is read off its distance along the segment', () => {
    const lateAfternoon = new Date('2026-10-29T21:30:00Z')
    const hazard = { ...found('unlit', undefined, 950), distance: 900 }
    expect(pointHazards([hazard], segment('walking'), { start: lateAfternoon, duration: 0, outlook: null })).toEqual([])
    expect(pointHazards([hazard], segment('walking'), { start: lateAfternoon, duration: 3 * 3600, outlook: null })).toHaveLength(1)
  })

  test('flood-prone roads only when rain is forecast, and never without a forecast', () => {
    expect(pointHazards([found('flood_prone')], segment(), dry)).toEqual([])
    expect(pointHazards([found('flood_prone')], segment(), { start: day, outlook: null })).toEqual([])
    expect(pointHazards([found('flood_prone')], segment(), { start: day, outlook: { rain: true, minTemperature: 12 } })).toHaveLength(1)
  })

  test('speed cameras only where warning of them is lawful, and premium', () => {
    expect(pointHazards([found('speed_camera')], segment('driving', 'USA'), dry)[0]).toMatchObject({ kind: 'speed_camera', premium: true })
    expect(pointHazards([found('speed_camera')], segment('driving', 'DEU'), dry)).toEqual([])
    expect(pointHazards([found('speed_camera')], segment('driving'), dry)).toEqual([])
  })

  test('clearances a car could hit', () => {
    expect(pointHazards([found('low_clearance', '2.1')], segment(), dry)).toHaveLength(1)
    expect(pointHazards([found('low_clearance', '4.2')], segment(), dry)).toEqual([])
  })

  test('walking beside a busy road with no sidewalk is the worse case', () => {
    expect(pointHazards([found('no_sidewalk', 'primary')], segment('walking'), dry)[0].severity).toBe('high')
    expect(pointHazards([found('no_sidewalk', 'residential')], segment('walking'), dry)[0].severity).toBe('medium')
  })

  test('kinds this client does not know are dropped', () => {
    expect(pointHazards([found('potholes')], segment(), dry)).toEqual([])
  })
})

describe('needsOutlook', () => {
  test('a bridge to drive over, or a flood-prone stretch', () => {
    expect(needsOutlook(segment(), [])).toBe(false)
    expect(needsOutlook(segment(), [found('flood_prone')])).toBe(true)
    expect(needsOutlook({ ...segment(), edgeSegments: [{ startDistance: 0, endDistance: 10, roadEnvironment: 'bridge' }] }, null)).toBe(true)
  })
})

describe('sunIsDown', () => {
  test('by the sun at that place and time', () => {
    expect(sunIsDown({ lat: 40.75, lng: -73.99 }, day)).toBe(false)
    expect(sunIsDown({ lat: 40.75, lng: -73.99 }, night)).toBe(true)
  })
})
