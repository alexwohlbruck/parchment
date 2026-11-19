/**
 * Reading geospatial files into GeoJSON.
 *
 * A canvas layer's data is always a `FeatureCollection`, whatever the user
 * dropped on it, so every format converges here. Everything runs in the
 * browser: there is no upload endpoint, and there doesn't need to be — the
 * data ends up inside the canvas document either way, which also means an
 * end-to-end encrypted canvas can hold an imported file without the server
 * ever seeing it.
 *
 * The cost of that is a size ceiling: a canvas body is read and written whole,
 * so a 40MB shapefile export would make every save enormous. Imports are
 * capped and told to simplify rather than silently producing a canvas that
 * takes ten seconds to open.
 */

import { kml as kmlToGeoJson, gpx as gpxToGeoJson } from '@tmcw/togeojson'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { formatFromFilename, type GeoFormat } from '@/lib/geo-file/geo-format'
import { fromWkt } from '@/lib/geo-file/wkt'

export interface GeoImportResult {
  collection: FeatureCollection
  format: GeoFormat
  filename: string
  /** Property names present on the features, for choosing a label. */
  properties: string[]
}

export class GeoImportError extends Error {
  /** i18n key under `canvases.import.errors`. */
  constructor(public readonly key: string) {
    super(key)
  }
}

/**
 * Roughly 4MB of GeoJSON. Beyond this a canvas stops being pleasant to open
 * and every save ships the whole thing again.
 */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024

function isFeatureCollection(value: unknown): value is FeatureCollection {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as FeatureCollection).type === 'FeatureCollection' &&
    Array.isArray((value as FeatureCollection).features)
  )
}

/** Wrap whatever GeoJSON shape we were handed into a collection. */
function toCollection(value: unknown): FeatureCollection {
  if (isFeatureCollection(value)) return value

  const node = value as { type?: string; geometry?: unknown }
  if (node?.type === 'Feature') {
    return { type: 'FeatureCollection', features: [value as Feature] }
  }
  if (typeof node?.type === 'string') {
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: value as Geometry, properties: {} },
      ],
    }
  }
  throw new GeoImportError('notGeoJson')
}

function parseXml(text: string, error: string): Document {
  const document = new DOMParser().parseFromString(text, 'text/xml')
  if (document.querySelector('parsererror')) throw new GeoImportError(error)
  return document
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Column names that mean latitude / longitude, in the order we prefer them. */
const LAT_KEYS = ['latitude', 'lat', 'y']
const LNG_KEYS = ['longitude', 'lng', 'lon', 'long', 'x']
const WKT_KEYS = ['wkt', 'geometry', 'geom', 'the_geom']

/**
 * A small RFC-4180 reader: quoted fields, doubled quotes inside them, and
 * newlines within a quoted field. Enough for spreadsheet exports, which is
 * what people actually bring.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += char
      continue
    }

    if (char === '"') quoted = true
    else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      // Swallow the \n of a \r\n pair rather than emitting a blank row.
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }

  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

function findColumn(headers: string[], candidates: string[]): number {
  const normalised = headers.map(h => h.trim().toLowerCase())
  for (const candidate of candidates) {
    const index = normalised.indexOf(candidate)
    if (index !== -1) return index
  }
  return -1
}

function pointFrom(latText = '', lngText = ''): Geometry | null {
  if (!latText.trim() || !lngText.trim()) return null
  const lat = Number(latText)
  const lng = Number(lngText)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { type: 'Point', coordinates: [lng, lat] }
}

function csvToCollection(text: string, delimiter: string): FeatureCollection {
  const rows = parseDelimited(text, delimiter)
  if (rows.length < 2) throw new GeoImportError('csvEmpty')

  const [headers, ...body] = rows
  const latIndex = findColumn(headers, LAT_KEYS)
  const lngIndex = findColumn(headers, LNG_KEYS)
  const wktIndex = findColumn(headers, WKT_KEYS)
  const hasPoints = latIndex !== -1 && lngIndex !== -1
  if (!hasPoints && wktIndex === -1) {
    throw new GeoImportError('csvNoCoordinates')
  }
  const geometryColumns = [latIndex, lngIndex, wktIndex]

  const features: Feature[] = []
  for (const cells of body) {
    // A row with an unreadable or out-of-range coordinate is skipped rather
    // than failing the import — one bad line shouldn't lose the other 900.
    const geometry =
      (wktIndex !== -1 && cells[wktIndex]?.trim() && fromWkt(cells[wktIndex])) ||
      (hasPoints && pointFrom(cells[latIndex], cells[lngIndex]))
    if (!geometry) continue

    const properties: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (geometryColumns.includes(index)) return
      const key = header.trim()
      if (key) properties[key] = cells[index] ?? ''
    })

    features.push({ type: 'Feature', geometry, properties })
  }

  if (!features.length) throw new GeoImportError('csvNoRows')
  return { type: 'FeatureCollection', features }
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** Every property name that appears on any feature, in first-seen order. */
export function collectPropertyNames(collection: FeatureCollection): string[] {
  const names: string[] = []
  for (const feature of collection.features) {
    for (const key of Object.keys(feature.properties ?? {})) {
      if (!names.includes(key)) names.push(key)
    }
  }
  return names
}

/**
 * Drop features with no geometry. They round-trip through the style spec as
 * nothing at all, and counting them makes an import look bigger than it drew.
 */
function withGeometry(collection: FeatureCollection): FeatureCollection {
  return {
    ...collection,
    features: collection.features.filter(f => !!f?.geometry),
  }
}

export function parseGeoData(
  text: string,
  filename: string,
  format?: GeoFormat,
): GeoImportResult {
  const resolved = format ?? formatFromFilename(filename)
  if (!resolved) throw new GeoImportError('unsupportedFormat')

  let collection: FeatureCollection
  switch (resolved) {
    case 'geojson': {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new GeoImportError('notGeoJson')
      }
      collection = toCollection(parsed)
      break
    }
    case 'kml':
      collection = kmlToGeoJson(parseXml(text, 'badKml')) as FeatureCollection
      break
    case 'gpx':
      collection = gpxToGeoJson(parseXml(text, 'badGpx')) as FeatureCollection
      break
    case 'csv':
      collection = csvToCollection(text, filename.endsWith('.tsv') ? '\t' : ',')
      break
  }

  collection = withGeometry(collection)
  if (!collection.features.length) throw new GeoImportError('noFeatures')

  return {
    collection,
    format: resolved,
    filename,
    properties: collectPropertyNames(collection),
  }
}

/** Read a picked file, with the size ceiling applied to the source text. */
export async function importGeoFile(file: File): Promise<GeoImportResult> {
  if (file.size > MAX_IMPORT_BYTES) throw new GeoImportError('tooLarge')
  const text = await file.text()
  const result = parseGeoData(text, file.name)

  // Converted output can outgrow its source — a compact GPX track becomes a
  // verbose LineString — so the ceiling is checked again on the result.
  if (JSON.stringify(result.collection).length > MAX_IMPORT_BYTES) {
    throw new GeoImportError('tooLarge')
  }
  return result
}
