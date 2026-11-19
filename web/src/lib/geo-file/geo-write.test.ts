import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { toCsv, toGpx, toKml } from './geo-write'
import { parseGeoData } from './geo-read'
import { geoFilename } from './geo-format'
import { fromWkt, toWkt } from './wkt'

const collection: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-73.98, 40.75] },
      properties: { name: 'Lunch & coffee', rating: 4, stroke: '#ff0000' },
    },
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] },
      properties: { name: 'Walk' },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]]],
      },
      properties: { name: 'Park', fill: '#00ff00', 'fill-opacity': 0.5 },
    },
  ],
}

const geometries = (text: string, filename: string) =>
  parseGeoData(text, filename).collection.features.map(f => f.geometry)

describe('KML', () => {
  it('reads back the same geometry, names and data', () => {
    const features = parseGeoData(toKml(collection, 'Trip'), 't.kml').collection.features

    expect(features.map(f => f.geometry)).toEqual(collection.features.map(f => f.geometry))
    expect(features[0].properties).toMatchObject({ name: 'Lunch & coffee', rating: '4' })
  })

  it('writes simplestyle colours as KML styles, alpha first and blue before red', () => {
    const kml = toKml(collection)
    expect(kml).toContain('<LineStyle><color>ff0000ff</color>')
    expect(kml).toContain('<PolyStyle><color>8000ff00</color>')
  })
})

describe('GPX', () => {
  it('writes points as waypoints and everything else as tracks', () => {
    const read = geometries(toGpx(collection), 't.gpx')

    expect(read).toHaveLength(3)
    expect(read).toEqual(
      expect.arrayContaining([
        collection.features[0].geometry,
        collection.features[1].geometry,
        { type: 'MultiLineString', coordinates: (collection.features[2].geometry as any).coordinates },
      ]),
    )
  })
})

describe('CSV', () => {
  it('reads back points from coordinates and shapes from WKT', () => {
    expect(geometries(toCsv(collection), 't.csv')).toEqual(
      collection.features.map(f => f.geometry),
    )
  })

  it('quotes awkward values and leaves styles out of the columns', () => {
    const [header, first] = toCsv(collection).split('\n')
    expect(header).toBe('name,rating,latitude,longitude,wkt')
    expect(first).toBe('Lunch & coffee,4,40.75,-73.98,')
    expect(toCsv({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'a, "b"' } }],
    })).toContain('"a, ""b"""')
  })
})

describe('WKT', () => {
  it('round-trips every geometry type it writes', () => {
    const shapes = [
      { type: 'Point', coordinates: [1.5, -2] },
      { type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] },
      { type: 'LineString', coordinates: [[0, 0], [1e-7, 2]] },
      { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] },
    ] as const
    for (const shape of shapes) expect(fromWkt(toWkt(shape as any))).toEqual(shape)
  })

  it('reads the bare MULTIPOINT spelling, and rejects nonsense', () => {
    expect(fromWkt('MULTIPOINT (1 2, 3 4)')).toEqual({ type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] })
    expect(fromWkt('CIRCLE (1 2)')).toBeNull()
    expect(fromWkt('not wkt')).toBeNull()
  })
})

describe('geoFilename', () => {
  it('slugs a name with the format extension, with a fallback', () => {
    expect(geoFilename('Café run · Brooklyn', 'kml')).toBe('cafe-run-brooklyn.kml')
    expect(geoFilename('—', 'geojson')).toBe('parchment.geojson')
  })
})
