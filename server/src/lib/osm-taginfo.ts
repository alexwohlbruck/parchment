import { logWarn } from './logger'

/**
 * Key and value suggestions for the raw tag editor, from the tagging schema's
 * own taginfo export — the same set iD offers. Nothing here reaches taginfo.io;
 * it's whatever the schema documents.
 */

export interface TagSuggestion {
  value: string
  /** A human label where the schema names the key, e.g. "surface" → "Surface". */
  label?: string
}

interface TagIndex {
  keys: string[]
  valuesByKey: Map<string, string[]>
  labelsByKey: Map<string, string>
}

let index: TagIndex | null = null
let indexAttempted = false

function buildIndex(): TagIndex | null {
  try {
    const taginfo = require('@openstreetmap/id-tagging-schema/dist/taginfo.min.json')
    const fields = require('@openstreetmap/id-tagging-schema/dist/fields.min.json')

    const valuesByKey = new Map<string, string[]>()
    const keys = new Set<string>()

    for (const tag of taginfo.tags ?? []) {
      if (!tag.key) continue
      keys.add(tag.key)
      if (!tag.value) continue
      const values = valuesByKey.get(tag.key) ?? []
      values.push(tag.value)
      valuesByKey.set(tag.key, values)
    }

    // Field options cover values the taginfo export leaves out (yes/no checks).
    const labelsByKey = new Map<string, string>()
    for (const field of Object.values<any>(fields)) {
      if (!field.key) continue
      keys.add(field.key)
      if (field.label && !labelsByKey.has(field.key)) {
        labelsByKey.set(field.key, field.label)
      }
      const options = Array.isArray(field.options)
        ? field.options
        : Object.keys(field.options ?? {})
      if (!options.length) continue
      const values = new Set(valuesByKey.get(field.key) ?? [])
      for (const option of options) values.add(String(option))
      valuesByKey.set(field.key, [...values])
    }

    for (const [key, values] of valuesByKey) {
      valuesByKey.set(key, [...new Set(values)].sort())
    }

    return { keys: [...keys].sort(), valuesByKey, labelsByKey }
  } catch (error) {
    logWarn('Could not build the OSM taginfo index', error)
    return null
  }
}

function getIndex(): TagIndex | null {
  if (!index && !indexAttempted) {
    indexAttempted = true
    index = buildIndex()
  }
  return index
}

function rank(candidate: string, query: string): number {
  if (candidate === query) return 100
  if (candidate.startsWith(query)) return 80
  if (candidate.includes(`:${query}`)) return 60
  if (candidate.includes(query)) return 40
  return 0
}

function search(candidates: string[], query: string, limit: number): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return candidates.slice(0, limit)

  return candidates
    .map((candidate) => ({ candidate, score: rank(candidate.toLowerCase(), q) }))
    .filter((scored) => scored.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.candidate.length - b.candidate.length,
    )
    .slice(0, limit)
    .map((scored) => scored.candidate)
}

/** Tag keys matching a query. */
export function suggestKeys(query: string, limit = 8): TagSuggestion[] {
  const idx = getIndex()
  if (!idx) return []
  return search(idx.keys, query, limit).map((key) => ({
    value: key,
    label: idx.labelsByKey.get(key),
  }))
}

/** Documented values for a key, matching a query. */
export function suggestValues(
  key: string,
  query: string,
  limit = 8,
): TagSuggestion[] {
  const idx = getIndex()
  if (!idx) return []
  return search(idx.valuesByKey.get(key) ?? [], query, limit).map((value) => ({
    value,
  }))
}
