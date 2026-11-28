import { describe, expect, mock, test } from 'bun:test'
import type { Place } from '../../types/place.types'
import { getArrivalPoints } from './arrival-points.service'

const bounds = { minLat: 40, maxLat: 41, minLng: -74, maxLng: -73 }

function place(id: string, presetId: string, withOutline = true): Place {
  return {
    id,
    name: { value: id },
    icon: { presetId },
    geometry: {
      value: {
        type: 'polygon',
        center: { lat: 40.5, lng: -73.5 },
        ...(withOutline && { bounds }),
      },
    },
  } as unknown as Place
}

const airport = place('osm/way/1', 'aeroway/aerodrome')
const terminal = place('osm/way/2', 'aeroway/terminal')
const borough = place('osm/relation/3', 'area')
const campus = place('osm/way/4', 'education/university')
const library = place('osm/way/5', 'amenity/library')
const lot = place('osm/way/6', 'amenity/parking')
const road = { ...place('osm/way/7', 'highway/residential'), tags: { highway: 'residential' } } as Place

function deps(records: Place[], containers: Place[] = []) {
  return {
    lookupOutline: mock(async (id: string) => records.find((r) => r.id === id) ?? null),
    containingAreas: mock(async () => containers),
    listChildren: mock(async () => [library, lot, road]),
    searchByCategory: mock(async () => [terminal]),
  }
}

describe('getArrivalPoints', () => {
  test('uses the place itself when it is an airport', async () => {
    const d = deps([airport])
    const result = await getArrivalPoints({ id: airport.id }, 'transit', d)
    expect(result.parent?.id).toBe(airport.id)
    expect(result.places.map((p) => p.id)).toEqual([terminal.id])
    expect(d.containingAreas).not.toHaveBeenCalled()
  })

  test('leads from a terminal back to its airport', async () => {
    const result = await getArrivalPoints(
      { id: terminal.id },
      'transit',
      deps([terminal, airport], [airport, borough]),
    )
    expect(result.parent?.id).toBe(airport.id)
  })

  test('looks around the stop\'s own point, not its place\'s centre', async () => {
    const d = deps([borough], [airport])
    await getArrivalPoints({ id: borough.id, lat: 40.64, lng: -73.77 }, 'transit', d)
    expect(d.containingAreas).toHaveBeenCalledWith(40.64, -73.77)
  })

  test('finds the airport around a dropped pin, fetching its outline', async () => {
    const outlineless = place(airport.id, 'aeroway/aerodrome', false)
    const d = deps([airport], [borough, outlineless])
    const result = await getArrivalPoints({ lat: 40.5, lng: -73.5 }, 'transit', d)
    expect(result.parent?.id).toBe(airport.id)
    expect(d.lookupOutline).toHaveBeenCalledWith(airport.id)
  })

  test('lists what is inside a campus, parking only when driving', async () => {
    const walking = await getArrivalPoints({ id: campus.id }, 'walking', deps([campus]))
    expect(walking.places.map((p) => p.id)).toEqual([library.id])
    const driving = await getArrivalPoints({ id: campus.id }, 'driving', deps([campus]))
    expect(driving.places.map((p) => p.id)).toEqual([lot.id, library.id])
  })

  test('offers nothing where no large place surrounds the point', async () => {
    const result = await getArrivalPoints({ lat: 40.5, lng: -73.5 }, 'driving', deps([], [borough]))
    expect(result).toEqual({ parent: null, places: [] })
  })
})
