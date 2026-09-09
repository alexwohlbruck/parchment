import { describe, it, expect } from 'vitest'
import {
  parseGeoData,
  parseDelimited,
  collectPropertyNames,
  formatFromFilename,
  GeoImportError,
} from './geo-import'

/**
 * Import is where other people's files meet the canvas, so the interesting
 * cases are all the malformed ones: a CSV with a stray row, a KML with an
 * empty folder, a GeoJSON that's really one feature. None of them should
 * lose the rest of the file, and none should produce a layer that silently
 * draws nothing.
 */

describe('formatFromFilename', () => {
  it('reads the extension, case-insensitively', () => {
    expect(formatFromFilename('tracks.GPX')).toBe('gpx')
    expect(formatFromFilename('places.geojson')).toBe('geojson')
    expect(formatFromFilename('data.tsv')).toBe('csv')
    expect(formatFromFilename('archive.zip')).toBeNull()
  })
})

describe('parseDelimited', () => {
  it('handles quoted fields, doubled quotes and embedded newlines', () => {
    const rows = parseDelimited('a,b\n"x,y","he said ""hi"""\n"multi\nline",z')

    expect(rows).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"'],
      ['multi\nline', 'z'],
    ])
  })

  it('treats CRLF as one row break and drops blank rows', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })
})

describe('parseGeoData — GeoJSON', () => {
  it('accepts a collection, a feature, or a bare geometry', () => {
    const point = { type: 'Point', coordinates: [1, 2] }

    expect(parseGeoData(JSON.stringify(point), 'a.geojson').collection.features)
      .toHaveLength(1)
    expect(
      parseGeoData(
        JSON.stringify({ type: 'Feature', geometry: point, properties: {} }),
        'a.geojson',
      ).collection.features,
    ).toHaveLength(1)
    expect(
      parseGeoData(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: point, properties: {} }],
        }),
        'a.geojson',
      ).collection.features,
    ).toHaveLength(1)
  })

  it('drops features with no geometry rather than shipping undrawable ones', () => {
    const result = parseGeoData(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: null, properties: { name: 'nowhere' } },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [1, 2] },
            properties: { name: 'here' },
          },
        ],
      }),
      'a.geojson',
    )

    expect(result.collection.features).toHaveLength(1)
  })

  it('rejects a document with nothing mappable in it', () => {
    expect(() =>
      parseGeoData(
        JSON.stringify({ type: 'FeatureCollection', features: [] }),
        'a.geojson',
      ),
    ).toThrow(GeoImportError)
  })

  it('rejects text that is not JSON at all', () => {
    expect(() => parseGeoData('<html>', 'a.geojson')).toThrow(GeoImportError)
  })
})

describe('parseGeoData — CSV', () => {
  const CSV = [
    'Name,Latitude,Longitude,Notes',
    'Wellington,-41.29,174.78,capital',
    'Auckland,-36.85,174.76,',
  ].join('\n')

  it('turns latitude/longitude columns into points', () => {
    const result = parseGeoData(CSV, 'places.csv')

    expect(result.collection.features).toHaveLength(2)
    expect(result.collection.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [174.78, -41.29],
    })
  })

  it('keeps the other columns as properties, minus the coordinates', () => {
    const result = parseGeoData(CSV, 'places.csv')

    expect(result.collection.features[0].properties).toEqual({
      Name: 'Wellington',
      Notes: 'capital',
    })
    expect(result.properties).toEqual(['Name', 'Notes'])
  })

  it('accepts lat/lon and x/y spellings', () => {
    const result = parseGeoData('lat,lon\n1,2', 'a.csv')

    expect(result.collection.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [2, 1],
    })
  })

  it('skips unusable rows instead of failing the whole file', () => {
    const result = parseGeoData(
      'lat,lng\n1,2\nnorth,west\n999,999\n3,4',
      'a.csv',
    )

    expect(result.collection.features).toHaveLength(2)
  })

  it('says what is wrong when there are no coordinate columns', () => {
    expect(() => parseGeoData('name,notes\na,b', 'a.csv')).toThrow(
      expect.objectContaining({ key: 'csvNoCoordinates' }),
    )
  })

  it('says what is wrong when every row is unusable', () => {
    expect(() => parseGeoData('lat,lng\nnorth,west', 'a.csv')).toThrow(
      expect.objectContaining({ key: 'csvNoRows' }),
    )
  })

  it('splits a .tsv on tabs', () => {
    const result = parseGeoData('name\tlat\tlng\nA\t1\t2', 'a.tsv')

    expect(result.collection.features[0].properties).toEqual({ name: 'A' })
  })
})

describe('parseGeoData — KML and GPX', () => {
  it('reads a KML placemark', () => {
    const kml = `<?xml version="1.0"?>
      <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
        <Placemark><name>Beehive</name>
          <Point><coordinates>174.7762,-41.2784,0</coordinates></Point>
        </Placemark>
      </Document></kml>`

    const result = parseGeoData(kml, 'a.kml')

    expect(result.format).toBe('kml')
    expect(result.collection.features).toHaveLength(1)
    expect(result.collection.features[0].properties?.name).toBe('Beehive')
  })

  it('reads a GPX track as a line', () => {
    const gpx = `<?xml version="1.0"?>
      <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Ride</name><trkseg>
        <trkpt lat="-41.28" lon="174.77"></trkpt>
        <trkpt lat="-41.29" lon="174.78"></trkpt>
      </trkseg></trk></gpx>`

    const result = parseGeoData(gpx, 'a.gpx')

    expect(result.format).toBe('gpx')
    expect(result.collection.features[0].geometry?.type).toBe('LineString')
  })

  it('rejects markup that will not parse', () => {
    expect(() => parseGeoData('<kml><unclosed>', 'a.kml')).toThrow(GeoImportError)
  })
})

describe('collectPropertyNames', () => {
  it('unions property names across features, in first-seen order', () => {
    expect(
      collectPropertyNames({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: null, properties: { b: 1, a: 2 } },
          { type: 'Feature', geometry: null, properties: { a: 3, c: 4 } },
        ],
      } as never),
    ).toEqual(['b', 'a', 'c'])
  })
})
