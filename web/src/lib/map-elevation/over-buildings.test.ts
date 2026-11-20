import { describe, expect, it } from 'vitest'
import { MapEngine } from '@/types/map.types'
import { groundProfile, overBuildings, withGroundProfiles } from './over-buildings'

describe('groundProfile', () => {
  it('writes one ground-level run per line, deltas after the first point', () => {
    expect(
      groundProfile({ type: 'LineString', coordinates: [[-73.5, 40.25], [-73.4999999, 40.2500002]] }),
    ).toBe('~-735000000,402500000,0,1,2,0')
  })

  it('gives each ring of an area its own run and skips what has no length', () => {
    const ring = [[0, 0], [0.0000001, 0], [0, 0]]
    expect(groundProfile({ type: 'Polygon', coordinates: [ring, ring] }).split(';')).toHaveLength(2)
    expect(groundProfile({ type: 'Point', coordinates: [0, 0] })).toBe('')
  })

  it('rides on every feature of a collection', () => {
    const data = withGroundProfiles({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { a: 1 }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }],
    })
    expect(data.features[0].properties).toMatchObject({ a: 1, groundProfile: expect.stringMatching(/^~/) })
  })
})

describe('overBuildings', () => {
  const line = { type: 'line', paint: { 'line-width': 3 } }

  it('lifts a MapLibre line out of the drape with nothing hiding it', () => {
    const lifted = overBuildings(line, MapEngine.MAPLIBRE) as any
    expect(lifted.layout['line-elevation-profile']).toEqual(['coalesce', ['get', 'groundProfile'], ''])
    expect(lifted.paint['line-depth-occlusion-factor']).toBe(0)
  })

  it('leaves fills and Mapbox alone, which would reject the properties', () => {
    expect(overBuildings({ type: 'fill' }, MapEngine.MAPLIBRE)).toEqual({ type: 'fill' })
    expect(overBuildings(line, MapEngine.MAPBOX)).toBe(line)
  })
})
