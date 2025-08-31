import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { api } from '@/lib/api'
import { CategoryResult } from '@/types/search.types'
import { fuzzyFilter } from '@/lib/utils'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@server/types/integration.types'

interface CachedCategoryData {
  categories: CategoryResult[]
  lastUpdated: string
  language: string
}

export const useCategoryStore = defineStore('category', () => {
  const { locale } = useI18n()

  // Storage for categories - keyed by language
  const categoryCache = useStorage<Record<string, CachedCategoryData>>(
    'parchment-categories',
    {},
    localStorage,
    {
      serializer: {
        read: (value: string) => {
          try {
            return JSON.parse(value)
          } catch {
            return {}
          }
        },
        write: (value: Record<string, CachedCategoryData>) =>
          JSON.stringify(value),
      },
    },
  )

  const loading = ref(false)
  const error = ref<string | null>(null)

  // Categories are now always available since they come from OSM tagging schema
  const isOverpassAvailable = computed(() => true)

  // Get categories for current language from cache
  const currentLanguageCategories = computed(() => {
    const cached = categoryCache.value[locale.value]
    return cached?.categories || []
  })

  // Check if categories need to be refreshed (older than 24 hours)
  const needsRefresh = computed(() => {
    const cached = categoryCache.value[locale.value]
    if (!cached) return true

    const lastUpdated = new Date(cached.lastUpdated)
    const now = new Date()
    const hoursSinceUpdate =
      (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60)

    return hoursSinceUpdate > 24 || cached.language !== locale.value
  })

  /**
   * Load categories from API and cache them
   */
  async function loadCategories(
    forceRefresh = false,
  ): Promise<CategoryResult[]> {
    // Return cached data if available and not stale
    if (
      !forceRefresh &&
      !needsRefresh.value &&
      currentLanguageCategories.value.length > 0
    ) {
      return currentLanguageCategories.value
    }

    loading.value = true
    error.value = null

    try {
      console.log(`Loading categories for language: ${locale.value}`)

      const response = await api.get<{
        categories: CategoryResult[]
        totalCount: number
      }>('/search/categories', {
        params: {
          maxResults: 1000,
        },
      })

      const categories = response.data.categories

      // Cache the results
      categoryCache.value[locale.value] = {
        categories,
        lastUpdated: new Date().toISOString(),
        language: locale.value,
      }

      console.log(
        `✅ Loaded ${categories.length} categories for ${locale.value}`,
      )
      return categories
    } catch (err) {
      console.error('Error loading categories:', err)
      error.value =
        err instanceof Error ? err.message : 'Failed to load categories'
      return []
    } finally {
      loading.value = false
    }
  }

  /**
   * Search categories using fuzzy matching
   */
  function searchCategories(query: string, maxResults = 10): CategoryResult[] {
    if (!query || query.trim().length === 0) {
      return []
    }

    const categories = currentLanguageCategories.value

    return fuzzyFilter(categories, query, {
      keys: ['name', 'description', 'aliases'],
      threshold: -1000, // Be permissive to catch partial matches
      preserveOrder: false, // Sort by relevance
    }).slice(0, maxResults)
  }

  /**
   * Get category by ID
   */
  function getCategoryById(categoryId: string): CategoryResult | undefined {
    return currentLanguageCategories.value.find(cat => cat.id === categoryId)
  }

  /**
   * Get categories by tag key (e.g., all categories with 'amenity' tag)
   */
  function getCategoriesByTag(tagKey: string): CategoryResult[] {
    return currentLanguageCategories.value.filter(cat =>
      Object.keys(cat.tags).includes(tagKey),
    )
  }

  /**
   * Get popular/featured categories (could be based on usage, common tags, etc.)
   */
  function getFeaturedCategories(limit = 20): CategoryResult[] {
    // Return categories with the most common main tags, sorted by specificity
    const commonTags = [
      'amenity',
      'shop',
      'leisure',
      'tourism',
      'natural',
      'highway',
    ]

    const featured: CategoryResult[] = []

    for (const tag of commonTags) {
      const categoriesWithTag = getCategoriesByTag(tag)
        .filter(cat =>
          // Prefer categories with specific values (not just '*')
          Object.values(cat.tags).some(value => value !== '*'),
        )
        .slice(0, Math.floor(limit / commonTags.length))

      featured.push(...categoriesWithTag)
    }

    return featured.slice(0, limit)
  }

  /**
   * Clear category cache (useful for language changes or debugging)
   */
  function clearCache(language?: string): void {
    if (language) {
      delete categoryCache.value[language]
    } else {
      categoryCache.value = {}
    }
  }

  /**
   * Initialize categories on store creation
   */
  function init(): Promise<CategoryResult[]> {
    return loadCategories()
  }

  return {
    // State
    loading,
    error,
    currentLanguageCategories,
    needsRefresh,
    isOverpassAvailable,

    // Actions
    loadCategories,
    searchCategories,
    getCategoryById,
    getCategoriesByTag,
    getFeaturedCategories,
    clearCache,
    init,
  }
})
