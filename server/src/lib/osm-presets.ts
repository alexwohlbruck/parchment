import type { Language } from './i18n'
import { getLanguageCode } from './i18n'

export type GeometryType = 'point' | 'line' | 'area' | 'vertex' | 'relation'

export interface PresetDefinition {
  id: string
  name: string
  tags: Record<string, string>
  addTags?: Record<string, string>
  geometry: GeometryType[]
  originalScore?: number
  fields?: string[]
  moreFields?: string[]
  icon?: string
  searchable?: boolean
}

export interface FieldDefinition {
  id: string
  key: string
  type: string
  label: string
  placeholder?: string
  options?: Record<string, string | { title: string }>
}

export interface MatchResult {
  preset: PresetDefinition
  score: number
  matchedTags: Record<string, string>
}

interface GeometryIndex {
  [geometry: string]: {
    [tagKey: string]: {
      [tagValue: string]: PresetDefinition[]
    }
  }
}

interface CacheStats {
  hits: number
  misses: number
  size: number
}

interface Cache {
  matches: Map<string, MatchResult | null>
  names: Map<string, string>
  fields: Map<string, FieldDefinition[]>
  icons: Map<string, string>
  stats: {
    matches: CacheStats
    names: CacheStats
    fields: CacheStats
    icons: CacheStats
  }
}

// Global state
let presets: Record<string, PresetDefinition> | null = null
let fields: Record<string, FieldDefinition> | null = null
let geometryIndex: GeometryIndex | null = null
let cache: Cache | null = null
const translations = new Map<string, any>()

const MAX_CACHE_SIZE = 10000

function createCache(): Cache {
  if (cache) return cache

  const createStats = (): CacheStats => ({ hits: 0, misses: 0, size: 0 })

  cache = {
    matches: new Map(),
    names: new Map(),
    fields: new Map(),
    icons: new Map(),
    stats: {
      matches: createStats(),
      names: createStats(),
      fields: createStats(),
      icons: createStats(),
    },
  }

  return cache
}

function evictOldEntries<K, V>(map: Map<K, V>, maxSize: number): void {
  if (map.size <= maxSize) return

  const toRemove = map.size - maxSize
  let count = 0

  for (const key of map.keys()) {
    if (count >= toRemove) break
    map.delete(key)
    count++
  }
}

function getCached<T>(
  map: Map<string, T>,
  stats: CacheStats,
  key: string,
  compute: () => T,
): T {
  if (map.has(key)) {
    stats.hits++
    return map.get(key)!
  }

  stats.misses++
  const value = compute()

  map.set(key, value)
  evictOldEntries(map, MAX_CACHE_SIZE)
  stats.size = map.size

  return value
}

function loadPresets(): Record<string, PresetDefinition> {
  if (presets) return presets

  const rawPresets = require('@openstreetmap/id-tagging-schema/dist/presets.min.json')

  let presetNames: Record<string, any> = {}
  try {
    const rawData = require('@openstreetmap/id-tagging-schema/dist/translations/en.json')
    presetNames = rawData.en?.presets?.presets || {}
  } catch (error) {
    console.warn('Could not load preset translations')
  }

  presets = {}
  for (const [id, preset] of Object.entries(rawPresets)) {
    const def = preset as any
    let name = presetNames[id]?.name

    if (!name && id.includes('/')) {
      const parts = id.split('/')
      if (parts.length === 3) {
        const parentName = presetNames[`${parts[0]}/${parts[1]}`]?.name
        const categoryName = presetNames[parts[0]]?.name
        name = parentName || categoryName
      } else if (parts.length === 2) {
        name = presetNames[parts[0]]?.name
      }
    }

    presets[id] = {
      id,
      name: name || def.name || id,
      tags: def.tags || {},
      addTags: def.addTags,
      geometry: def.geometry || ['point'],
      originalScore: def.originalScore || def.matchScore || 1.0,
      fields: def.fields || [],
      moreFields: def.moreFields || [],
      icon: def.icon,
      searchable: def.searchable !== false,
    }
  }

  return presets
}

function loadFields(): Record<string, FieldDefinition> {
  if (fields) return fields

  const rawFields = require('@openstreetmap/id-tagging-schema/dist/fields.min.json')
  fields = {}

  for (const [id, field] of Object.entries(rawFields)) {
    const def = field as any
    fields[id] = {
      id,
      key: def.key || id,
      type: def.type || 'text',
      label: def.label || id,
      placeholder: def.placeholder,
      options: def.options,
    }
  }

  return fields
}

function buildIndex(presets: Record<string, PresetDefinition>): GeometryIndex {
  if (geometryIndex) return geometryIndex

  geometryIndex = {}

  for (const preset of Object.values(presets)) {
    for (const geometry of preset.geometry) {
      if (!geometryIndex[geometry]) {
        geometryIndex[geometry] = {}
      }

      for (const [tagKey, tagValue] of Object.entries(preset.tags)) {
        if (!geometryIndex[geometry][tagKey]) {
          geometryIndex[geometry][tagKey] = {}
        }
        if (!geometryIndex[geometry][tagKey][tagValue]) {
          geometryIndex[geometry][tagKey][tagValue] = []
        }
        geometryIndex[geometry][tagKey][tagValue].push(preset)
      }
    }
  }

  return geometryIndex
}

function loadTranslations(language: Language): any {
  const apiLang = getLanguageCode(language)
  if (translations.has(apiLang)) {
    return translations.get(apiLang)
  }

  try {
    const rawData = require(`@openstreetmap/id-tagging-schema/dist/translations/${apiLang}.json`)
    const data = rawData[apiLang]
    translations.set(apiLang, data)
    return data
  } catch (error) {
    if (apiLang !== 'en') {
      return loadTranslations('en-US')
    }
    return { presets: { presets: {}, fields: {} } }
  }
}

function scorePreset(
  preset: PresetDefinition,
  tags: Record<string, string>,
): number {
  let score = 0
  const seen: Record<string, boolean> = {}

  for (const [key, value] of Object.entries(preset.tags)) {
    seen[key] = true
    if (tags[key] === value) {
      score += preset.originalScore || 1.0
    } else if (value === '*' && key in tags) {
      score += (preset.originalScore || 1.0) / 2
    } else {
      return -1
    }
  }

  if (preset.addTags) {
    for (const [key, value] of Object.entries(preset.addTags)) {
      if (!seen[key] && tags[key] === value) {
        score += preset.originalScore || 1.0
      }
    }
  }

  if (!preset.searchable) {
    score *= 0.999
  }

  return score
}

function findCandidates(
  tags: Record<string, string>,
  geometry: GeometryType,
): MatchResult[] {
  const presetData = loadPresets()
  const index = buildIndex(presetData)
  const candidates: MatchResult[] = []
  const seen = new Set<string>()

  for (const [tagKey, tagValue] of Object.entries(tags)) {
    const geometryData = index[geometry]
    if (!geometryData) continue

    const tagData = geometryData[tagKey]
    if (!tagData) continue

    const potentials = tagData[tagValue] || []
    const wildcards = tagData['*'] || []

    for (const preset of [...potentials, ...wildcards]) {
      if (seen.has(preset.id)) continue
      seen.add(preset.id)

      const score = scorePreset(preset, tags)
      if (score > -1) {
        candidates.push({
          preset,
          score,
          matchedTags: { ...preset.tags },
        })
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

function handleFallback(
  tags: Record<string, string>,
  geometry: GeometryType,
): MatchResult | null {
  for (const key of Object.keys(tags)) {
    if (/^addr:/.test(key)) {
      const addressPreset = loadPresets()['address']
      if (addressPreset) {
        return {
          preset: addressPreset,
          score: 0.1,
          matchedTags: { 'addr:housenumber': '*' },
        }
      }
    }
  }

  const fallbacks: Record<GeometryType, string> = {
    point: 'point',
    line: 'line',
    area: 'area',
    vertex: 'point',
    relation: 'relation',
  }

  const fallbackPreset = loadPresets()[fallbacks[geometry]]
  if (fallbackPreset) {
    return {
      preset: fallbackPreset,
      score: 0.01,
      matchedTags: {},
    }
  }

  return null
}

function createCacheKey(
  tags: Record<string, string>,
  geometry: GeometryType,
): string {
  const sortedTags = Object.keys(tags)
    .sort()
    .map((key) => `${key}=${tags[key]}`)
    .join('|')

  return `${geometry}:${sortedTags}`
}

export function matchTags(
  tags: Record<string, string>,
  geometry: GeometryType = 'point',
): MatchResult | null {
  const c = createCache()
  const key = createCacheKey(tags, geometry)

  return getCached(c.matches, c.stats.matches, key, () => {
    const candidates = findCandidates(tags, geometry)
    return candidates.length > 0
      ? candidates[0]
      : handleFallback(tags, geometry)
  })
}

export function getPresetName(
  preset: PresetDefinition,
  language: Language = 'en-US',
): string {
  if (getLanguageCode(language) === 'en') {
    return preset.name
  }

  const c = createCache()
  const key = `${preset.id}:${getLanguageCode(language)}`

  return getCached(c.names, c.stats.names, key, () => {
    const data = loadTranslations(language)
    const presetTranslations = data.presets?.presets || {}

    let name = presetTranslations[preset.id]?.name

    if (!name && preset.id.includes('/')) {
      const parts = preset.id.split('/')

      if (parts.length === 3) {
        const parentName = presetTranslations[`${parts[0]}/${parts[1]}`]?.name
        if (parentName) name = parentName
      }

      if (!name && parts.length >= 2) {
        const categoryName = presetTranslations[parts[0]]?.name
        if (categoryName) name = categoryName
      }
    }

    return name || preset.name
  })
}

export function getPresetIcon(
  preset: PresetDefinition,
  geometry: GeometryType = 'point',
): string {
  const c = createCache()
  const key = `${preset.id}:${geometry}`

  return getCached(c.icons, c.stats.icons, key, () => {
    if (preset.icon) return preset.icon

    const geometryIcons: Record<GeometryType, string> = {
      point: 'maki-circle',
      line: 'iD-line',
      area: 'iD-area',
      vertex: 'maki-circle-stroked',
      relation: 'iD-relation',
    }

    return geometryIcons[geometry] || 'maki-circle'
  })
}

export function getPresetFields(
  preset: PresetDefinition,
  language: Language = 'en-US',
): FieldDefinition[] {
  const c = createCache()
  const key = `${preset.id}:${getLanguageCode(language)}`

  return getCached(c.fields, c.stats.fields, key, () => {
    const fieldData = loadFields()
    const translations = loadTranslations(language)
    const fieldTranslations = translations.fields || {}

    const resolveFieldRefs = (fieldIds: string[]): string[] => {
      return fieldIds.flatMap((fieldId) => {
        if (fieldId.startsWith('{') && fieldId.endsWith('}')) {
          const refId = fieldId.slice(1, -1)
          const refPreset = loadPresets()[refId]
          return refPreset ? refPreset.fields || [] : []
        }
        return [fieldId]
      })
    }

    const allFieldIds = [
      ...resolveFieldRefs(preset.fields || []),
      ...resolveFieldRefs(preset.moreFields || []),
    ]

    return allFieldIds
      .map((fieldId) => {
        const field = fieldData[fieldId]
        if (!field) return null

        const translatedField = { ...field }
        const fieldTranslation = fieldTranslations[fieldId]

        if (fieldTranslation) {
          translatedField.label = fieldTranslation.label || field.label
          translatedField.placeholder =
            fieldTranslation.placeholder || field.placeholder

          if (field.options && fieldTranslation.options) {
            translatedField.options = { ...field.options }
            for (const [key, value] of Object.entries(
              fieldTranslation.options,
            )) {
              if (translatedField.options[key] && typeof value === 'string') {
                translatedField.options[key] = value
              } else if (
                translatedField.options[key] &&
                typeof value === 'object' &&
                value !== null &&
                'title' in value
              ) {
                translatedField.options[key] = value as { title: string }
              }
            }
          }
        }

        return translatedField
      })
      .filter((field): field is FieldDefinition => field !== null)
  })
}

export function getPlaceType(
  tags: Record<string, string>,
  language: Language = 'en-US',
  geometry: GeometryType = 'point',
): string {
  const match = matchTags(tags, geometry)
  if (match?.preset) {
    return getPresetName(match.preset, language)
  }

  const fallbacks: Record<string, { place: string; unnamed: string }> = {
    en: { place: 'Place', unnamed: 'Unnamed Place' },
    es: { place: 'Lugar', unnamed: 'Lugar sin nombre' },
  }

  const fallback = fallbacks[getLanguageCode(language)] || fallbacks.en
  return tags.name ? fallback.place : fallback.unnamed
}

export function getBestPresetMatch(
  tags: Record<string, string>,
  geometry: GeometryType = 'point',
): MatchResult | null {
  return matchTags(tags, geometry)
}

export function getPlaceIcon(
  tags: Record<string, string>,
  geometry: GeometryType = 'point',
): string {
  const match = matchTags(tags, geometry)
  if (match?.preset) {
    return getPresetIcon(match.preset, geometry)
  }

  const geometryIcons: Record<GeometryType, string> = {
    point: 'maki-circle',
    line: 'iD-line',
    area: 'iD-area',
    vertex: 'maki-circle-stroked',
    relation: 'iD-relation',
  }

  return geometryIcons[geometry] || 'maki-circle'
}

export function getPlaceFields(
  tags: Record<string, string>,
  language: Language = 'en-US',
  geometry: GeometryType = 'point',
): FieldDefinition[] {
  const match = matchTags(tags, geometry)
  if (match?.preset) {
    return getPresetFields(match.preset, language)
  }
  return []
}

export function getCacheStats(): Cache['stats'] | null {
  return cache?.stats || null
}

export function clearCache(type?: keyof Cache['stats']): void {
  if (!cache) return

  if (type) {
    cache[type].clear()
    cache.stats[type] = { hits: 0, misses: 0, size: 0 }
  } else {
    cache.matches.clear()
    cache.names.clear()
    cache.fields.clear()
    cache.icons.clear()

    const createStats = (): CacheStats => ({ hits: 0, misses: 0, size: 0 })
    cache.stats = {
      matches: createStats(),
      names: createStats(),
      fields: createStats(),
      icons: createStats(),
    }
  }
}

export function clearAllData(): void {
  presets = null
  fields = null
  geometryIndex = null
  cache = null
  translations.clear()
}

export function initializeOsmPresets(): void {
  console.log('🏗️  Initializing OSM preset system...')
  const start = Date.now()

  const presetData = loadPresets()
  const fieldData = loadFields()
  buildIndex(presetData)
  createCache()

  console.log(`✅ OSM preset system ready:`)
  console.log(`   - ${Object.keys(presetData).length} presets`)
  console.log(`   - ${Object.keys(fieldData).length} fields`)
  console.log(`   - Geometry index built`)
  console.log(`   - Cache initialized`)
  console.log(`   - Took ${Date.now() - start}ms`)
}
