import { sql, getTableColumns } from 'drizzle-orm'
import type { Table } from 'drizzle-orm'
import * as turf from '@turf/turf'

export function withGeometryAsCoordinates<T extends Record<string, any>>(
  table: T,
  geometryFieldName: string = 'geometry',
) {
  const { [geometryFieldName]: geometryField, ...otherFields } = table
  return {
    ...otherFields,
    lat: sql<number>`ST_Y(${geometryField})`,
    lng: sql<number>`ST_X(${geometryField})`,
  }
}

export function createSelectFieldsWithGeometry(
  table: Table,
  geometryFieldName: string = 'geometry',
) {
  const columns = getTableColumns(table)
  const { [geometryFieldName]: geometryField, ...otherColumns } = columns

  return {
    ...otherColumns,
    lat: sql<number>`ST_Y(${geometryField})`,
    lng: sql<number>`ST_X(${geometryField})`,
  } as typeof otherColumns & {
    lat: ReturnType<typeof sql<number>>
    lng: ReturnType<typeof sql<number>>
  }
}

export function createPointFromCoordinates(lat: number, lng: number) {
  return sql`ST_GeomFromText(${'POINT(' + lng + ' ' + lat + ')'}, 4326)`
}

export interface OSMElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: Array<{ lat: number; lon: number }>
  bounds?: {
    minlat: number
    maxlat: number
    minlon: number
    maxlon: number
  }
  center?: { lat: number; lon: number }
}

export function calculateOSMCenter(
  element: OSMElement,
): { lat: number; lng: number } | null {
  if (element.center) {
    return { lat: element.center.lat, lng: element.center.lon }
  }

  if (element.type === 'node' && element.lat && element.lon) {
    return { lat: element.lat, lng: element.lon }
  }

  if (element.geometry && element.geometry.length > 0) {
    const coordinates = element.geometry.map((node) => [node.lon, node.lat])
    const lineString = turf.lineString(coordinates)
    const center = turf.centroid(lineString)
    return {
      lat: center.geometry.coordinates[1],
      lng: center.geometry.coordinates[0],
    }
  }

  if (element.bounds) {
    return {
      lat: (element.bounds.minlat + element.bounds.maxlat) / 2,
      lng: (element.bounds.minlon + element.bounds.maxlon) / 2,
    }
  }

  return null
}
