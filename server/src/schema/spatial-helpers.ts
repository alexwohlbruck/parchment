import { customType, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// Enhanced PostGIS geometry type
export function spatialColumn<T extends string>(
  name: T,
  geometryType:
    | 'POINT'
    | 'LINESTRING'
    | 'POLYGON'
    | 'MULTIPOINT'
    | 'MULTILINESTRING'
    | 'MULTIPOLYGON' = 'POINT',
  srid: number = 4326,
) {
  return customType<{ data: string; driverData: string }>({
    dataType() {
      return `geometry(${geometryType}, ${srid})`
    },
  })(name)
}

// TODO: Review indexes techniques, performance
// Helper to create spatial index using Drizzle's index function
export function spatialIndex(indexName: string, column: any) {
  return index(indexName).using('gist', column)
}

// Helper to create trigram index for text search using pg_trgm
export function trigramIndex(indexName: string, column: any) {
  return index(indexName).using('gin', sql`${column} gin_trgm_ops`)
}

// Pre-defined geometry types for common use cases
export const pointGeometry = (name: string) => spatialColumn(name, 'POINT')
export const lineGeometry = (name: string) => spatialColumn(name, 'LINESTRING')
export const polygonGeometry = (name: string) => spatialColumn(name, 'POLYGON')
export const multiPointGeometry = (name: string) =>
  spatialColumn(name, 'MULTIPOINT')
export const multiLineGeometry = (name: string) =>
  spatialColumn(name, 'MULTILINESTRING')
export const multiPolygonGeometry = (name: string) =>
  spatialColumn(name, 'MULTIPOLYGON')
