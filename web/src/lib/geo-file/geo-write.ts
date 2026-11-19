/**
 * Writing GeoJSON out as a file in any format we can also read back.
 *
 * KML keeps every property, in `ExtendedData`, and simplestyle colours as its
 * own styles. GPX has no areas, so a polygon is written as a closed track.
 * CSV gives points latitude and longitude columns and anything else WKT.
 */

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import { toWkt } from '@/lib/geo-file/wkt'
import { GEO_FORMATS, geoFilename, type GeoFormat } from '@/lib/geo-file/geo-format'
import { saveFile } from '@/lib/file-save'

/** Simplestyle keys, which KML writes as a style rather than as data. */
const STYLE_KEYS = new Set([
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'fill',
  'fill-opacity',
  'marker-color',
])

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function text(value: unknown): string {
  if (value == null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function featureName(feature: Feature): string {
  const { name, title, label } = feature.properties ?? {}
  return text(name ?? title ?? label)
}

// ── KML ──────────────────────────────────────────────────────────────────────

const kmlCoordinates = (positions: Position[]) =>
  `<coordinates>${positions.map(p => p.join(',')).join(' ')}</coordinates>`

function kmlPolygon(rings: Position[][]): string {
  const [outer, ...holes] = rings
  return (
    '<Polygon>' +
    `<outerBoundaryIs><LinearRing>${kmlCoordinates(outer)}</LinearRing></outerBoundaryIs>` +
    holes
      .map(hole => `<innerBoundaryIs><LinearRing>${kmlCoordinates(hole)}</LinearRing></innerBoundaryIs>`)
      .join('') +
    '</Polygon>'
  )
}

function kmlGeometry(geometry: Geometry): string {
  switch (geometry.type) {
    case 'Point':
      return `<Point>${kmlCoordinates([geometry.coordinates])}</Point>`
    case 'LineString':
      return `<LineString>${kmlCoordinates(geometry.coordinates)}</LineString>`
    case 'Polygon':
      return kmlPolygon(geometry.coordinates)
    case 'MultiPoint':
      return `<MultiGeometry>${geometry.coordinates.map(p => kmlGeometry({ type: 'Point', coordinates: p })).join('')}</MultiGeometry>`
    case 'MultiLineString':
      return `<MultiGeometry>${geometry.coordinates.map(l => kmlGeometry({ type: 'LineString', coordinates: l })).join('')}</MultiGeometry>`
    case 'MultiPolygon':
      return `<MultiGeometry>${geometry.coordinates.map(kmlPolygon).join('')}</MultiGeometry>`
    case 'GeometryCollection':
      return `<MultiGeometry>${geometry.geometries.map(kmlGeometry).join('')}</MultiGeometry>`
  }
}

/** KML colours are `aabbggrr`. Anything but a six-digit hex is left out. */
function kmlColor(hex: unknown, opacity: unknown = 1): string | null {
  const match = typeof hex === 'string' && /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const [r, g, b] = [0, 2, 4].map(i => match[1].slice(i, i + 2))
  const alpha = Math.round(Math.min(1, Math.max(0, Number(opacity) || 0)) * 255)
  return `${alpha.toString(16).padStart(2, '0')}${b}${g}${r}`.toLowerCase()
}

function kmlStyle(properties: Record<string, unknown>): string {
  const parts: string[] = []
  const icon = kmlColor(properties['marker-color'])
  if (icon) parts.push(`<IconStyle><color>${icon}</color></IconStyle>`)
  const line = kmlColor(properties.stroke, properties['stroke-opacity'] ?? 1)
  if (line) {
    const width = properties['stroke-width']
    parts.push(`<LineStyle><color>${line}</color>${width != null ? `<width>${width}</width>` : ''}</LineStyle>`)
  }
  const fill = kmlColor(properties.fill, properties['fill-opacity'] ?? 1)
  if (fill) parts.push(`<PolyStyle><color>${fill}</color></PolyStyle>`)
  return parts.length ? `<Style>${parts.join('')}</Style>` : ''
}

function kmlPlacemark(feature: Feature): string {
  const properties = feature.properties ?? {}
  const name = featureName(feature)
  const data = Object.entries(properties)
    .filter(([key, value]) => !STYLE_KEYS.has(key) && key !== 'name' && value != null)
    .map(([key, value]) => `<Data name="${escapeXml(key)}"><value>${escapeXml(text(value))}</value></Data>`)
    .join('')
  return (
    '<Placemark>' +
    (name ? `<name>${escapeXml(name)}</name>` : '') +
    kmlStyle(properties) +
    (data ? `<ExtendedData>${data}</ExtendedData>` : '') +
    kmlGeometry(feature.geometry) +
    '</Placemark>'
  )
}

export function toKml(collection: FeatureCollection, name = ''): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
    (name ? `<name>${escapeXml(name)}</name>` : '') +
    collection.features.filter(f => f.geometry).map(kmlPlacemark).join('') +
    '</Document></kml>\n'
  )
}

// ── GPX ──────────────────────────────────────────────────────────────────────

const gpxPoint = (tag: string, [lng, lat, ele]: Position, inner = '') =>
  `<${tag} lat="${lat}" lon="${lng}">${ele != null ? `<ele>${ele}</ele>` : ''}${inner}</${tag}>`

const gpxSegment = (positions: Position[]) =>
  `<trkseg>${positions.map(p => gpxPoint('trkpt', p)).join('')}</trkseg>`

/** Points as waypoints, everything else as a track of one or more segments. */
function gpxParts(geometry: Geometry): { points: Position[]; segments: Position[][] } {
  switch (geometry.type) {
    case 'Point':
      return { points: [geometry.coordinates], segments: [] }
    case 'MultiPoint':
      return { points: geometry.coordinates, segments: [] }
    case 'LineString':
      return { points: [], segments: [geometry.coordinates] }
    case 'MultiLineString':
    case 'Polygon':
      return { points: [], segments: geometry.coordinates }
    case 'MultiPolygon':
      return { points: [], segments: geometry.coordinates.flat() }
    case 'GeometryCollection': {
      const parts = geometry.geometries.map(gpxParts)
      return {
        points: parts.flatMap(p => p.points),
        segments: parts.flatMap(p => p.segments),
      }
    }
  }
}

export function toGpx(collection: FeatureCollection, name = ''): string {
  const waypoints: string[] = []
  const tracks: string[] = []
  for (const feature of collection.features) {
    if (!feature.geometry) continue
    const title = featureName(feature)
    const label = title ? `<name>${escapeXml(title)}</name>` : ''
    const { points, segments } = gpxParts(feature.geometry)
    for (const point of points) waypoints.push(gpxPoint('wpt', point, label))
    if (segments.length) tracks.push(`<trk>${label}${segments.map(gpxSegment).join('')}</trk>`)
  }
  // The schema wants every waypoint before the first track.
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Parchment" xmlns="http://www.topografix.com/GPX/1/1">' +
    (name ? `<metadata><name>${escapeXml(name)}</name></metadata>` : '') +
    waypoints.join('') +
    tracks.join('') +
    '</gpx>\n'
  )
}

// ── CSV ──────────────────────────────────────────────────────────────────────

function csvCell(value: unknown): string {
  const cell = text(value)
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

/** Only flat values make useful columns; nested records are left out. */
function csvColumns(collection: FeatureCollection): string[] {
  const columns: string[] = []
  for (const feature of collection.features) {
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      if (STYLE_KEYS.has(key) || (value !== null && typeof value === 'object')) continue
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return columns
}

export function toCsv(collection: FeatureCollection): string {
  const columns = csvColumns(collection)
  const rows = collection.features
    .filter(feature => feature.geometry)
    .map(feature => {
      const point = feature.geometry.type === 'Point' ? feature.geometry.coordinates : null
      return [
        ...columns.map(column => csvCell(feature.properties?.[column])),
        point ? point[1] : '',
        point ? point[0] : '',
        point ? '' : csvCell(toWkt(feature.geometry)),
      ].join(',')
    })
  const header = [...columns.map(csvCell), 'latitude', 'longitude', 'wkt'].join(',')
  return [header, ...rows].join('\n') + '\n'
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function writeGeoFile(
  collection: FeatureCollection,
  format: GeoFormat,
  name = '',
): Blob {
  const body =
    format === 'kml'
      ? toKml(collection, name)
      : format === 'gpx'
        ? toGpx(collection, name)
        : format === 'csv'
          ? toCsv(collection)
          : JSON.stringify(collection)
  return new Blob([body], { type: GEO_FORMATS[format].mime })
}

/** Write a collection and hand it to the user under `name`. */
export function exportGeoFile(
  collection: FeatureCollection,
  name: string,
  format: GeoFormat,
): Promise<void> {
  return saveFile(writeGeoFile(collection, format, name), geoFilename(name, format))
}
