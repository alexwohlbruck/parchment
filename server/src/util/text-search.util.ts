import { sql, or } from 'drizzle-orm'

/**
 * PostgreSQL native text search utilities using pg_trgm extension
 * Much more powerful than basic ILIKE pattern matching
 */

/**
 * Creates a flexible search condition that combines exact matches and fuzzy similarity
 * Can work with any set of fields, not just bookmarks
 *
 * @param fields - Array of database fields to search in
 * @param query - Search query string
 * @returns SQL condition or null if query is empty
 */
export function createMultiFieldSearchCondition(fields: any[], query: string) {
  if (!query || query.trim().length === 0) return null

  const cleanQuery = query.trim().toLowerCase()

  // Strategy 1: Exact matches (ILIKE for case-insensitive)
  const exactConditions = fields.map(
    (field) => sql`LOWER(${field}) LIKE ${`%${cleanQuery}%`}`,
  )

  // Strategy 2: Similarity matches using pg_trgm
  const similarityConditions = fields.map(
    (field) => sql`${field} % ${cleanQuery}`,
  )

  // Combine strategies with OR (any match wins)
  return or(...exactConditions, ...similarityConditions)
}

/**
 * Optimized bookmark search - wrapper around the generic function
 * Maintained for backward compatibility
 */
export function createBookmarkSearchCondition(
  nameField: any,
  addressField: any,
  presetField: any,
  query: string,
) {
  return createMultiFieldSearchCondition(
    [nameField, addressField, presetField],
    query,
  )
}
