/** Well-known text, which is how a spreadsheet holds anything but a point. */

import type { Geometry, Position } from 'geojson'

const pair = (position: Position) => position.join(' ')
const list = (positions: Position[]) => `(${positions.map(pair).join(', ')})`
const rings = (polygon: Position[][]) => `(${polygon.map(list).join(', ')})`

export function toWkt(geometry: Geometry): string {
  switch (geometry.type) {
    case 'Point':
      return `POINT (${pair(geometry.coordinates)})`
    case 'MultiPoint':
      return `MULTIPOINT (${geometry.coordinates.map(p => `(${pair(p)})`).join(', ')})`
    case 'LineString':
      return `LINESTRING ${list(geometry.coordinates)}`
    case 'MultiLineString':
      return `MULTILINESTRING ${rings(geometry.coordinates)}`
    case 'Polygon':
      return `POLYGON ${rings(geometry.coordinates)}`
    case 'MultiPolygon':
      return `MULTIPOLYGON (${geometry.coordinates.map(rings).join(', ')})`
    case 'GeometryCollection':
      return `GEOMETRYCOLLECTION (${geometry.geometries.map(toWkt).join(', ')})`
  }
}

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const COORDINATE = new RegExp(`(${NUMBER})\\s+(${NUMBER})(?:\\s+(${NUMBER}))?(?:\\s+${NUMBER})?`, 'g')

/** Read a WKT geometry, or null for anything we don't understand. */
export function fromWkt(text: string): Geometry | null {
  const match = /^\s*([A-Za-z]+)\s*(?:ZM|Z|M)?\s*(\(.*\))\s*$/s.exec(text)
  if (!match) return null
  const type = match[1].toUpperCase()

  let nested: unknown
  try {
    nested = JSON.parse(
      match[2]
        .replace(COORDINATE, (_, x, y, z) => `[${x},${y}${z ? `,${z}` : ''}]`)
        .replace(/\(/g, '[')
        .replace(/\)/g, ']'),
    )
  } catch {
    return null
  }

  const value = nested as any
  switch (type) {
    case 'POINT':
      return { type: 'Point', coordinates: value[0] }
    case 'MULTIPOINT':
      return {
        type: 'MultiPoint',
        coordinates: value.map((p: any) => (Array.isArray(p[0]) ? p[0] : p)),
      }
    case 'LINESTRING':
      return { type: 'LineString', coordinates: value }
    case 'MULTILINESTRING':
      return { type: 'MultiLineString', coordinates: value }
    case 'POLYGON':
      return { type: 'Polygon', coordinates: value }
    case 'MULTIPOLYGON':
      return { type: 'MultiPolygon', coordinates: value }
    default:
      return null
  }
}
