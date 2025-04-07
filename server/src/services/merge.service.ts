import type { AttributedValue } from '../types/unified-place.types'
import { SOURCE, SOURCE_PRIORITIES } from '../lib/constants'

/**
 * Gets the priority of a data source
 * Higher value = higher priority
 */
export function getSourcePriority(sourceId: string): number {
  return SOURCE_PRIORITIES[sourceId as keyof typeof SOURCE_PRIORITIES] || 0
}

/**
 * Registers a new data source with a priority
 * Can be used to dynamically add new sources or change priorities
 */
export function registerSourcePriority(
  sourceId: string,
  priority: number,
): void {
  ;(SOURCE_PRIORITIES as Record<string, number>)[sourceId] = priority
}

/**
 * Merges a new attributed value with existing values based on source priority
 * Higher priority sources replace lower priority ones
 * Equal priority sources are added to the list
 */
export function mergeAttributedValues<T>(
  existing: AttributedValue<T>[],
  newValue: AttributedValue<T>,
): AttributedValue<T>[] {
  if (!existing || existing.length === 0) {
    return [newValue]
  }

  const existingPriority = getSourcePriority(existing[0]?.sourceId || '')
  const newPriority = getSourcePriority(newValue.sourceId)

  if (newPriority > existingPriority) {
    return [newValue]
  }

  if (newPriority < existingPriority) {
    return existing
  }

  return [...existing, newValue]
}

/**
 * Selects the best value from a list of attributed values based on source priority
 */
export function selectBestValue<T>(values: AttributedValue<T>[]): T | null {
  if (!values || values.length === 0) return null
  if (values.length === 1) return values[0].value

  return values.sort((a, b) => {
    const priorityA = getSourcePriority(a.sourceId)
    const priorityB = getSourcePriority(b.sourceId)
    return priorityB - priorityA
  })[0].value
}

/**
 * Merges records of attributed values, respecting source priorities
 */
export function mergeAttributedRecords<T>(
  existing: Record<string, AttributedValue<T>[]> | undefined,
  newRecord: Record<string, AttributedValue<T>[]>,
): Record<string, AttributedValue<T>[]> {
  const result: Record<string, AttributedValue<T>[]> = { ...(existing || {}) }

  Object.entries(newRecord).forEach(([key, values]) => {
    if (!values || values.length === 0) return

    if (!result[key]) {
      result[key] = [...values]
      return
    }

    // Merge each new value into the existing array
    values.forEach((value) => {
      result[key] = mergeAttributedValues(result[key], value)
    })
  })

  return result
}

/**
 * Standard ISO date string format for consistency across the application
 */
export function getTimestamp(): string {
  return new Date().toISOString()
}
