import { sql, getTableColumns } from 'drizzle-orm'
import type { Table } from 'drizzle-orm'

/**
 * Generic function to convert PostGIS geometry fields to lat/lng coordinates
 * Works with any Drizzle table that has geometry columns
 *
 * @param table - The Drizzle table object
 * @param geometryFieldName - Name of the geometry field (default: 'geometry')
 * @returns Object with all table fields except geometry, plus lat/lng from geometry
 */
export function withGeometryAsCoordinates<T extends Record<string, any>>(
  table: T,
  geometryFieldName: string = 'geometry',
) {
  // Extract all fields except the geometry field
  const { [geometryFieldName]: geometryField, ...otherFields } = table

  // Return all other fields plus lat/lng extracted from geometry
  return {
    ...otherFields,
    lat: sql<number>`ST_Y(${geometryField})`,
    lng: sql<number>`ST_X(${geometryField})`,
  }
}

/**
 * Create select/returning fields for any table with geometry, automatically converting geometry to lat/lng
 * Uses getTableColumns to automatically include all fields except geometry
 *
 * @param table - The Drizzle table object
 * @param geometryFieldName - Name of the geometry field (default: 'geometry')
 * @returns Select object with all table columns except geometry, plus lat/lng fields
 */
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

/**
 * Helper to create a geometry Point from lat/lng coordinates
 * Useful for INSERT and UPDATE operations with PostGIS
 *
 * @param lat - Latitude coordinate
 * @param lng - Longitude coordinate
 * @returns SQL expression for creating a POINT geometry
 */
export function createPointFromCoordinates(lat: number, lng: number) {
  return sql`ST_GeomFromText(${'POINT(' + lng + ' ' + lat + ')'}, 4326)`
}
