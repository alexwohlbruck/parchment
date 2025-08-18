import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { api } from '@/lib/api'
import { CategoryResult } from '@/types/search.types'
import { useCategoryStore } from '@/stores/category.store'
import { usePlaceSearchService } from '@/services/search.service'
import { useMapService } from './map.service'
import type { Place } from '@/types/place.types'

function categoryService() {
  const selectedCategory = ref<CategoryResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function selectCategory(
    categoryId: string,
  ): Promise<CategoryResult | null> {
    loading.value = true
    error.value = null

    try {
      const categoryStore = useCategoryStore()

      let category = categoryStore.getCategoryById(categoryId)

      if (!category) {
        const response = await api.get<CategoryResult>(
          `/search/categories/${categoryId}`,
        )
        category = response.data
      }

      if (category) {
        selectedCategory.value = category
        return category
      }

      error.value = 'Category not found'
      return null
    } catch (err) {
      console.error('Error selecting category:', err)
      error.value =
        err instanceof Error ? err.message : 'Failed to load category'
      return null
    } finally {
      loading.value = false
    }
  }

  function generateOverpassQuery(
    category: CategoryResult,
    bounds?: { north: number; south: number; east: number; west: number },
    maxResults = 1000,
  ): string {
    const { tags, addTags, geometry } = category

    const tagFilters: string[] = []

    // Add main tags
    Object.entries(tags).forEach(([key, value]) => {
      if (value === '*') {
        tagFilters.push(`["${key}"]`)
      } else {
        tagFilters.push(`["${key}"="${value}"]`)
      }
    })

    // Add additional tags if specified
    if (addTags) {
      Object.entries(addTags).forEach(([key, value]) => {
        if (value === '*') {
          tagFilters.push(`["${key}"]`)
        } else {
          tagFilters.push(`["${key}"="${value}"]`)
        }
      })
    }

    const tagFilter = tagFilters.join('')

    // Determine which geometry types to query
    const queryTypes: string[] = []

    geometry.forEach(geomType => {
      switch (geomType) {
        case 'point':
          queryTypes.push('node')
          break
        case 'line':
          queryTypes.push('way')
          break
        case 'area':
        case 'polygon':
        case 'multipolygon':
          queryTypes.push('way', 'relation')
          break
        case 'vertex':
          queryTypes.push('node')
          break
        case 'relation':
          queryTypes.push('relation')
          break
      }
    })

    // Remove duplicates
    const uniqueTypes = [...new Set(queryTypes)]

    // Build bounding box constraint
    let boundingBox = ''
    if (bounds) {
      boundingBox = `(${bounds.south},${bounds.west},${bounds.north},${bounds.east})`
    }

    // Build the Overpass query
    const queries = uniqueTypes.map(type => {
      if (type === 'way' && geometry.includes('area')) {
        // For areas, filter ways that are closed (first node = last node)
        return `${type}${tagFilter}${boundingBox}[~"area"~"yes|true"];`
      }
      return `${type}${tagFilter}${boundingBox};`
    })

    const query = `
[out:json][timeout:25];
(
  ${queries.join('\n  ')}
);
out geom ${maxResults};
`.trim()

    return query
  }

  /**
   * Get the currently selected category
   */
  function getCurrentCategory(): CategoryResult | null {
    return selectedCategory.value
  }

  /**
   * Clear the selected category
   */
  function clearSelection(): void {
    selectedCategory.value = null
    error.value = null
  }

  /**
   * Get Overpass query for current category
   */
  function getCurrentOverpassQuery(
    bounds?: { north: number; south: number; east: number; west: number },
    maxResults = 1000,
  ): string | null {
    if (!selectedCategory.value) return null
    return generateOverpassQuery(selectedCategory.value, bounds, maxResults)
  }

  /**
   * Build a human-readable description of what the category represents
   */
  function getCategoryDescription(category: CategoryResult): string {
    const mainTag = Object.entries(category.tags)[0]
    if (!mainTag) return 'Unknown category'

    const [key, value] = mainTag
    if (value === '*') {
      return `All places with ${key} tag`
    }

    // Convert key/value to readable text
    const readableKey = key.replace(/_/g, ' ')
    const readableValue = value.replace(/_/g, ' ')

    return `${readableValue} (${readableKey})`
  }

  /**
   * Get search suggestions for Overpass queries
   */
  function getOverpassSearchSuggestions(category: CategoryResult): string[] {
    const suggestions: string[] = []

    // Add category name
    suggestions.push(category.name)

    // Add aliases
    if (category.aliases) {
      suggestions.push(...category.aliases)
    }

    // Add tag values
    Object.values(category.tags).forEach(value => {
      if (value !== '*') {
        suggestions.push(value.replace(/_/g, ' '))
      }
    })

    return [...new Set(suggestions)] // Remove duplicates
  }

  /**
   * Execute category search using Overpass API
   */
  async function searchCategoryPlaces(
    category: CategoryResult,
    bounds?: { north: number; south: number; east: number; west: number },
    maxResults = 100,
  ): Promise<Place[]> {
    const searchService = usePlaceSearchService()

    if (!searchService.isAdvancedSearchAvailable()) {
      throw new Error(
        'Advanced search is not available. Overpass integration is not configured.',
      )
    }

    const query = generateOverpassQuery(category, bounds, maxResults)
    return await searchService.executeOverpassQuery(query, maxResults)
  }

  /**
   * Execute current category search
   */
  async function searchCurrentCategory(
    bounds?: { north: number; south: number; east: number; west: number },
    maxResults = 100,
  ): Promise<Place[]> {
    if (!selectedCategory.value) {
      throw new Error('No category selected')
    }

    return await searchCategoryPlaces(
      selectedCategory.value,
      bounds,
      maxResults,
    )
  }

  return {
    // State
    selectedCategory,
    loading,
    error,

    // Actions
    selectCategory,
    generateOverpassQuery,
    getCurrentCategory,
    clearSelection,
    getCurrentOverpassQuery,
    getCategoryDescription,
    getOverpassSearchSuggestions,
    searchCategoryPlaces,
    searchCurrentCategory,
  }
}

export const useCategoryService = createSharedComposable(categoryService)
