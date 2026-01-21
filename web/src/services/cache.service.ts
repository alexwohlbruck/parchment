/**
 * Unified cache management service
 * Handles clearing all cached data from localStorage and Pinia stores on sign out
 */

import { useIntegrationsStore } from '@/stores/integrations.store'
import { useLayersStore } from '@/stores/layers.store'
import { useCategoryStore } from '@/stores/category.store'

/**
 * Clear all cached user data from localStorage and Pinia stores.
 * Call this on sign out or when user session becomes invalid.
 */
export function clearAllUserCaches() {
  const integrationsStore = useIntegrationsStore()
  const layersStore = useLayersStore()
  const categoryStore = useCategoryStore()
  
  // Clear all store caches
  integrationsStore.clearCache()
  layersStore.clearCache()
  categoryStore.clearCache()
  
  // Clear any other localStorage keys that should be removed on sign out
  // Add additional keys here as needed
  const keysToRemove = [
    'parchment-user',
    'parchment-user-layers', 
    'parchment-layer-groups',
    'integration-configurations',
    'available-integrations',
  ]
  
  keysToRemove.forEach(key => {
    try {
      localStorage.removeItem(key)
    } catch (e) {
      console.warn(`Failed to remove localStorage key: ${key}`, e)
    }
  })
}
