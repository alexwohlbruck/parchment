import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/lib/api'
import { CategoryResult } from '@/types/search.types'
import { fuzzyFilter } from '@/lib/utils'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@server/types/integration.types'
import { useAppDataCache } from '@/lib/app-data-cache'

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
    return useAppDataCache<CategoryResult[]>(`parchment-categories-${language}`, {
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

    return fuzzyFilter(currentLanguageCategories.value, query, {
      keys: ['name', 'description', 'aliases'],
      threshold: -1000,
      preserveOrder: false,
    }).slice(0, maxResults)
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
