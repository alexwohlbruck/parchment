import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/lib/api'
import { CategoryResult } from '@/types/search.types'
import { useAppDataCache } from '@/lib/app-data-cache'
import { STORAGE_KEYS } from '@/lib/storage'

// ---------------------------------------------------------------------------
// Scoring helpers (mirrors server/src/services/category.service.ts logic)
//
// WHY duplicate? The client fetches all categories once (cached 24 h) and
// searches them locally for instant, zero-latency autocomplete. An API call
// per keystroke would add noticeable lag. The algorithm is small and stable;
// keep both in sync. Ideal long-term: extract to a shared/ package.
// ---------------------------------------------------------------------------

/**
 * Normalize a word for fuzzy comparison: lowercase, strip common suffixes.
 * Handles plural/gerund/past-tense so "restaurants" matches "Restaurant".
 */
function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/ies$/, 'y')   // parties → party
    .replace(/ves$/, 'f')   // knives → knife
    .replace(/ing$/, '')     // parking → park
    .replace(/ed$/, '')      // parked → park
    .replace(/s$/, '')       // racks → rack
}

/**
 * Word-level fuzzy score. Returns > 0 when all query words appear (via prefix)
 * in the target, 0 otherwise. Handles word order variations and plurals.
 */
function wordOverlapScore(query: string, target: string): number {
  const qWords = query.trim().split(/\s+/).map(normalizeWord).filter(Boolean)
  const tWords = target.toLowerCase().split(/\s+/).map(normalizeWord).filter(Boolean)
  if (qWords.length === 0 || tWords.length === 0) return 0

  const allMatch = qWords.every((qw) =>
    tWords.some((tw) => tw.startsWith(qw) || qw.startsWith(tw)),
  )
  if (!allMatch) return 0

  const lengthRatio = Math.min(qWords.length, tWords.length) / Math.max(qWords.length, tWords.length)
  return 60 * lengthRatio
}

/**
 * Score a single category against a search term using the same tiered
 * algorithm as the server. Returns 0 for no match.
 *
 * Scoring tiers:
 *   1000 exact name match
 *    800 exact alias match
 *    500 name starts with query
 *    400 alias starts with query
 *    250 name has query at word boundary
 *    200 alias has query at word boundary
 *    150 exact tag-value match
 *    100 name contains query anywhere
 *     80 alias contains query anywhere
 *     60 word-overlap fuzzy (plurals / partial prefixes)
 *     50 tag value contains query
 * Plus up to +50 length bonus (shorter names rank higher).
 */
function scoreCategory(category: CategoryResult, query: string): number {
  const searchTerm = query.toLowerCase().trim()
  const normalizedTerm = normalizeWord(searchTerm)
  const terms = normalizedTerm !== searchTerm ? [searchTerm, normalizedTerm] : [searchTerm]

  let score = 0
  const nameLower = category.name.toLowerCase()

  // Name checks
  for (const term of terms) {
    if (nameLower === term) {
      score = Math.max(score, term === searchTerm ? 1000 : 950)
    } else if (nameLower.startsWith(term)) {
      score = Math.max(score, term === searchTerm ? 500 : 475)
    } else if (nameLower.includes(` ${term}`) || nameLower.includes(`${term} `)) {
      score = Math.max(score, term === searchTerm ? 250 : 225)
    } else if (nameLower.includes(term)) {
      score = Math.max(score, term === searchTerm ? 100 : 90)
    }
  }

  // Alias checks
  for (const alias of category.aliases || []) {
    const aliasLower = alias.toLowerCase()
    for (const term of terms) {
      if (aliasLower === term) {
        score = Math.max(score, term === searchTerm ? 800 : 760)
      } else if (aliasLower.startsWith(term)) {
        score = Math.max(score, term === searchTerm ? 400 : 380)
      } else if (aliasLower.includes(` ${term}`) || aliasLower.includes(`${term} `)) {
        score = Math.max(score, term === searchTerm ? 200 : 180)
      } else if (aliasLower.includes(term)) {
        score = Math.max(score, term === searchTerm ? 80 : 72)
      }
    }
  }

  // Tag value checks
  for (const tagValue of Object.values(category.tags ?? {})) {
    const tagLower = (tagValue as string).toLowerCase().replace(/_/g, ' ')
    if (tagLower === searchTerm) {
      score = Math.max(score, 150)
    } else if (tagLower.includes(searchTerm)) {
      score = Math.max(score, 50)
    }
  }

  // Word-overlap fuzzy fallback (fires for any query length, handles plurals)
  if (score === 0) {
    const nameOverlap = wordOverlapScore(searchTerm, nameLower)
    score += nameOverlap

    if (score === 0) {
      for (const alias of category.aliases || []) {
        const aliasOverlap = wordOverlapScore(searchTerm, alias.toLowerCase())
        if (aliasOverlap > 0) {
          score += aliasOverlap
          break
        }
      }
    }
  }

  // Length bonus: shorter names are more specific/relevant
  if (score > 0) {
    score += Math.max(0, 50 - category.name.length)
  }

  return score
}

// Bump when CategoryResult schema changes
const SCHEMA_VERSION = 3

export const useCategoryStore = defineStore('category', () => {
  const { locale } = useI18n()

  const loading = ref(false)
  const error = ref<string | null>(null)
  const categoriesByLanguage = ref<Record<string, CategoryResult[]>>({})

  // Categories are always available since they come from OSM tagging schema
  const isOverpassAvailable = computed(() => true)

  const currentLanguageCategories = computed(
    () => categoriesByLanguage.value[locale.value] || [],
  )

  function getCache(language: string) {
    return useAppDataCache<CategoryResult[]>(STORAGE_KEYS.cache.categories(language), {
      schemaVersion: SCHEMA_VERSION,
      maxAgeHours: 24,
    })
  }

  /**
   * Load categories from cache or API for the current locale
   */
  async function loadCategories(forceRefresh = false): Promise<CategoryResult[]> {
    const lang = locale.value
    const cache = getCache(lang)

    // Return in-memory copy if already loaded this session
    if (!forceRefresh && categoriesByLanguage.value[lang]?.length) {
      return categoriesByLanguage.value[lang]
    }

    // Return cached copy if still fresh
    if (!forceRefresh && !cache.isStale()) {
      const cached = cache.get()
      if (cached?.length) {
        categoriesByLanguage.value[lang] = cached
        return cached
      }
    }

    loading.value = true
    error.value = null

    try {
      const response = await api.get<{
        categories: CategoryResult[]
        totalCount: number
      }>('/search/categories', {
        params: { maxResults: 1000 },
      })

      const categories = response.data.categories
      cache.set(categories)
      categoriesByLanguage.value[lang] = categories
      return categories
    } catch (err) {
      console.error('Error loading categories:', err)
      error.value = err instanceof Error ? err.message : 'Failed to load categories'
      return []
    } finally {
      loading.value = false
    }
  }

  function searchCategories(query: string, maxResults = 10): CategoryResult[] {
    if (!query || query.trim().length === 0) return []

    const scored: Array<{ category: CategoryResult; score: number }> = []

    for (const category of currentLanguageCategories.value) {
      const score = scoreCategory(category, query)
      if (score > 0) scored.push({ category, score })
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((m) => m.category)
  }

  function getCategoryById(categoryId: string): CategoryResult | undefined {
    return currentLanguageCategories.value.find(cat => cat.id === categoryId)
  }

  function getCategoriesByTag(tagKey: string): CategoryResult[] {
    return currentLanguageCategories.value.filter(cat =>
      Object.keys(cat.tags).includes(tagKey),
    )
  }

  function getFeaturedCategories(limit = 20): CategoryResult[] {
    const commonTags = ['amenity', 'shop', 'leisure', 'tourism', 'natural', 'highway']
    const featured: CategoryResult[] = []
    for (const tag of commonTags) {
      const categoriesWithTag = getCategoriesByTag(tag)
        .filter(cat => Object.values(cat.tags).some(value => value !== '*'))
        .slice(0, Math.floor(limit / commonTags.length))
      featured.push(...categoriesWithTag)
    }
    return featured.slice(0, limit)
  }

  function clearCache(language?: string): void {
    if (language) {
      getCache(language).clear()
      delete categoriesByLanguage.value[language]
    } else {
      // Clear all language caches
      Object.keys(categoriesByLanguage.value).forEach(lang => getCache(lang).clear())
      categoriesByLanguage.value = {}
    }
  }

  function init(): Promise<CategoryResult[]> {
    return loadCategories()
  }

  return {
    loading,
    error,
    currentLanguageCategories,
    isOverpassAvailable,

    loadCategories,
    searchCategories,
    getCategoryById,
    getCategoriesByTag,
    getFeaturedCategories,
    clearCache,
    init,
  }
})
