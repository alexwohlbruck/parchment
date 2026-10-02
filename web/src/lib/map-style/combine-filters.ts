import {
  convertFilter,
  expression,
  type FilterSpecification,
} from '@maplibre/maplibre-gl-style-spec'

/**
 * `all` of the truthy clauses, as one expression filter. A style's legacy
 * filters are converted first, since the spec rejects mixing the two syntaxes.
 */
export function combineFilters(clauses: unknown[]): FilterSpecification | null {
  const filters = clauses
    .filter(Boolean)
    .map(f =>
      expression.isExpressionFilter(f) ? f : convertFilter(f as FilterSpecification),
    )
  if (!filters.length) return null
  return (filters.length === 1 ? filters[0] : ['all', ...filters]) as FilterSpecification
}
