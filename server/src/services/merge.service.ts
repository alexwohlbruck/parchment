import type { AttributedValue } from '../types/unified-place.types'

const SOURCE_PRIORITIES = {
  osm: 100,
  google: 80,
  wikidata: 60,
} as const

export function getSourcePriority(sourceId: string): number {
  return SOURCE_PRIORITIES[sourceId as keyof typeof SOURCE_PRIORITIES] || 0
}

export function mergeAttributedValues<T>(
  existing: AttributedValue<T>[],
  newValue: AttributedValue<T>,
): AttributedValue<T>[] {
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

export function selectBestValue<T>(values: AttributedValue<T>[]): T | null {
  if (!values || values.length === 0) return null
  if (values.length === 1) return values[0].value

  return values.sort((a, b) => {
    const priorityA = getSourcePriority(a.sourceId)
    const priorityB = getSourcePriority(b.sourceId)
    return priorityB - priorityA
  })[0].value
}
