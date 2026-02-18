import { CategoryResult } from '../types/search.types'
import type { Language } from '../lib/i18n/i18n.types'
import { getLanguageCode } from '../lib/i18n'

interface CachedCategoryData {
  categories: CategoryResult[]
  lastUpdated: string
}

// Cache by API language code (en, es) to avoid recomputing
const categoryCache = new Map<string, CachedCategoryData>()

export class CategoryService {
  /**
   * Load all searchable categories/presets from OSM tagging schema
   * Returns categories with translations for the given language
   */
  loadCategories(language: Language = 'en-US'): CategoryResult[] {
    const apiLang = getLanguageCode(language)
    // Check cache first
    const cached = categoryCache.get(apiLang)
    if (cached) {
      return cached.categories
    }

    const start = Date.now()

    try {
      // Load presets directly since loadPresets is not exported
      const rawPresets = require('@openstreetmap/id-tagging-schema/dist/presets.min.json')

      // Load translations (OSM schema uses two-letter codes)
      let translations: any = {}
      let presetTranslations: any = {}
      try {
        const rawTranslations = require(`@openstreetmap/id-tagging-schema/dist/translations/${apiLang}.json`)
        translations = rawTranslations[apiLang] || {}
        presetTranslations = translations?.presets?.presets || {}
      } catch (error) {
        if (apiLang !== 'en') {
          try {
            const enTranslations = require('@openstreetmap/id-tagging-schema/dist/translations/en.json')
            translations = enTranslations.en || {}
            presetTranslations = translations?.presets?.presets || {}
          } catch (enError) {
            console.warn('Could not load translations for', apiLang)
          }
        }
      }

      const categories: CategoryResult[] = []

      for (const [presetId, rawPreset] of Object.entries(rawPresets)) {
        const preset = rawPreset as any

        // Only include searchable presets that have meaningful tags
        const tags = preset.tags || {}
        const searchable = preset.searchable !== false

        if (!searchable || Object.keys(tags).length === 0) {
          continue
        }

        // Skip very generic presets that would match too many things
        const isGeneric = [
          'point',
          'line',
          'area',
          'vertex',
          'relation',
        ].includes(presetId)
        if (isGeneric) {
          continue
        }

        // Get localized name
        let localizedName =
          presetTranslations[presetId]?.name || preset.name || presetId

        // Fallback name handling for nested presets
        if (!localizedName && presetId.includes('/')) {
          const parts = presetId.split('/')
          if (parts.length === 3) {
            const parentName =
              presetTranslations[`${parts[0]}/${parts[1]}`]?.name
            const categoryName = presetTranslations[parts[0]]?.name
            localizedName = parentName || categoryName || presetId
          } else if (parts.length === 2) {
            localizedName = presetTranslations[parts[0]]?.name || presetId
          }
        }

        // Build aliases from various sources
        const aliases: string[] = []

        // Add terms from translations if available
        const translationData = presetTranslations[presetId]
        if (translationData?.terms) {
          aliases.push(...translationData.terms)
        }

        // Add the English name if different from localized name
        if (language !== 'en' && preset.name !== localizedName) {
          aliases.push(preset.name)
        }

        // Add tag values as potential search terms
        Object.values(tags).forEach((tagValue: unknown) => {
          if (
            typeof tagValue === 'string' &&
            tagValue !== '*' &&
            !aliases.includes(tagValue)
          ) {
            aliases.push(tagValue.replace(/_/g, ' '))
          }
        })

        const category: CategoryResult = {
          id: presetId,
          type: 'category',
          name: localizedName,
          description: this.getPresetDescription(
            preset,
            presetTranslations[presetId],
          ),
          icon: preset.icon || 'maki-circle',
          tags: tags,
          addTags: preset.addTags,
          geometry: preset.geometry || ['point'],
          fields: preset.fields,
          searchable: searchable,
          aliases: aliases.filter(Boolean), // Remove empty strings
        }

        categories.push(category)
      }

      // Sort categories by relevance (more specific tags first, then alphabetically)
      categories.sort((a, b) => {
        const aTagCount = Object.keys(a.tags).length
        const bTagCount = Object.keys(b.tags).length

        if (aTagCount !== bTagCount) {
          return bTagCount - aTagCount // More tags = more specific
        }

        return a.name.localeCompare(b.name)
      })

      // Cache the results
      const cacheData: CachedCategoryData = {
        categories,
        lastUpdated: new Date().toISOString(),
      }
      categoryCache.set(apiLang, cacheData)

      return categories
    } catch (error) {
      return []
    }
  }

  /**
   * Search categories by name and aliases
   */
  searchCategories(
    query: string,
    language: Language = 'en',
    maxResults: number = 10,
  ): CategoryResult[] {
    if (!query || query.trim().length === 0) {
      return []
    }

    const categories = this.loadCategories(language)
    const searchTerm = query.toLowerCase().trim()

    const matches: Array<{ category: CategoryResult; score: number }> = []

    for (const category of categories) {
      let score = 0
      const categoryNameLower = category.name.toLowerCase()

      // Exact name match gets highest score
      if (categoryNameLower === searchTerm) {
        score += 1000
      }
      // Name starts with query
      else if (categoryNameLower.startsWith(searchTerm)) {
        score += 500
      }
      // Name contains query (word boundary match gets priority)
      else if (
        categoryNameLower.includes(` ${searchTerm}`) ||
        categoryNameLower.includes(`${searchTerm} `)
      ) {
        score += 250
      }
      // Name contains query anywhere
      else if (categoryNameLower.includes(searchTerm)) {
        score += 100
      }

      // Check aliases with lower priority than main name
      for (const alias of category.aliases || []) {
        const aliasLower = alias.toLowerCase()
        if (aliasLower === searchTerm) {
          score += 800
        } else if (aliasLower.startsWith(searchTerm)) {
          score += 400
        } else if (
          aliasLower.includes(` ${searchTerm}`) ||
          aliasLower.includes(`${searchTerm} `)
        ) {
          score += 200
        } else if (aliasLower.includes(searchTerm)) {
          score += 80
        }
      }

      // Check tag values with lowest priority
      for (const tagValue of Object.values(category.tags)) {
        const tagLower = tagValue.toLowerCase().replace(/_/g, ' ')
        if (tagLower === searchTerm) {
          score += 150
        } else if (tagLower.includes(searchTerm)) {
          score += 50
        }
      }

      // Boost score for shorter names (more specific/relevant)
      if (score > 0) {
        const lengthBonus = Math.max(0, 50 - category.name.length)
        score += lengthBonus
        matches.push({ category, score })
      }
    }

    // Sort by score (descending) and return top results
    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((match) => match.category)
  }

  /**
   * Get category by ID
   */
  getCategoryById(
    categoryId: string,
    language: Language = 'en',
  ): CategoryResult | null {
    const categories = this.loadCategories(language)
    return categories.find((cat) => cat.id === categoryId) || null
  }

  /**
   * Clear category cache (useful for testing or language changes)
   */
  clearCategoryCache(language?: Language): void {
    if (language) {
      categoryCache.delete(language)
    } else {
      categoryCache.clear()
    }
  }

  /**
   * Helper to get preset description from translations
   */
  private getPresetDescription(
    preset: any,
    translationData?: any,
  ): string | undefined {
    // Try to get description from translations
    if (translationData?.description) {
      return translationData.description
    }

    // Fallback: create description from tag info
    const mainTag = Object.entries(preset.tags)[0]
    if (mainTag) {
      const [key, value] = mainTag
      if (value !== '*') {
        return `${key}=${value}`
      }
    }

    return undefined
  }
}

export const categoryService = new CategoryService()
