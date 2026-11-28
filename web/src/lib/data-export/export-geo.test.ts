import { describe, expect, it } from 'vitest'
import { toGpx, toKml } from '@/lib/geo-file/geo-write'
import { parseGeoData } from '@/lib/geo-file/geo-read'
import { libraryPlaces, routeTracks } from './export-geo'
import { EXPORT } from './fixtures'

describe('libraryPlaces', () => {
  const places = libraryPlaces(EXPORT.library)

  it('includes bookmarks and private collections alike, named after their collections', () => {
    expect(places.features.map(f => f.properties)).toEqual([
      { name: 'Café & Bar', address: '2 Elm St', collections: 'Coffee', osm: 'node/1' },
      { name: 'Clinic <East>', address: '1 Main St', collections: 'Doctors', osm: 'node/7' },
    ])
    expect(places.features[0].geometry.coordinates).toEqual([-73.98, 40.75])
  })

  it('reads back from GeoJSON and KML with the same places', () => {
    const geojson = parseGeoData(JSON.stringify(places), 'places.geojson').collection
    const kml = parseGeoData(toKml(places, 'Saved places'), 'places.kml').collection

    for (const parsed of [geojson, kml]) {
      expect(parsed.features.map(f => f.properties)).toEqual(places.features.map(f => f.properties))
      expect(parsed.features.map(f => f.geometry)).toEqual(places.features.map(f => f.geometry))
    }
  })
})

describe('routeTracks', () => {
  const tracks = routeTracks(EXPORT.routes.routes)

  it('carries elevation into the coordinates when it lines up with the path', () => {
    expect(tracks.features[0].geometry.coordinates).toEqual([
      [-80, 35, 200],
      [-80.05, 35.05, 210],
      [-80.1, 35.1, 205],
    ])
  })

  it('leaves elevation out when it does not match the path', () => {
    const [route] = EXPORT.routes.routes
    const mismatched = { ...route, body: { ...route.body, elevation: [1] } }

    expect(routeTracks([mismatched]).features[0].geometry.coordinates[0]).toEqual([-80, 35])
  })

  it('skips a route with no path to draw', () => {
    const [route] = EXPORT.routes.routes

    expect(routeTracks([{ ...route, body: { ...route.body, geometry: [[-80, 35]] } }]).features).toEqual([])
  })

  it('writes a GPX track that reads back with its name and elevation', () => {
    const gpx = toGpx(tracks, 'Saved routes')
    const [track] = parseGeoData(gpx, 'routes.gpx').collection.features

    expect(gpx).toContain('<trk><name>Greenway loop</name>')
    expect(gpx).toContain('<ele>210</ele>')
    expect(track.properties?.name).toBe('Greenway loop')
    expect(track.geometry).toEqual({ type: 'LineString', coordinates: tracks.features[0].geometry.coordinates })
  })
})
