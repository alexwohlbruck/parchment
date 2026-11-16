/** The parts of a preset field that decide whether results can be filtered on it. */
export interface FilterableField {
  key: string
  type: string
  options?: Record<string, unknown>
}

const FILTERABLE_FIELD_TYPES = new Set(['combo', 'check', 'semiCombo', 'radio'])

/** Whether a preset field becomes a filter on that preset's results. */
export function isFilterableField(field: FilterableField): boolean {
  return FILTERABLE_FIELD_TYPES.has(field.type) && (field.type === 'check' || !!field.options)
}

/** Whether filtering on `field` can keep only places tagged `key=value`. */
export function fieldFiltersTag(field: FilterableField, key: string, value: string): boolean {
  if (field.key !== key || !isFilterableField(field)) return false
  return field.type === 'check' ? value === 'yes' : value in (field.options ?? {})
}
