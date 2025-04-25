import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useLibraryStore } from '@/stores/library.store'
import type { UnifiedPlace } from '@/types/unified-place.types'
import type {
  CreateSavedPlaceParams,
  CreateCollectionParams,
  SavedPlace,
  Collection,
} from '@/types/library.types'
import { ref } from 'vue'
import { api } from '@/lib/api'

export const useLibraryService = createSharedComposable(() => {
  const libraryStore = useLibraryStore()
  const isSaving = ref(false)

  // Fetch data
  async function fetchPlaces() {
    try {
      const response = await api.get('/library/places')
      const places = response.data
      libraryStore.setSavedPlaces(places)
      return places
    } catch (error) {
      toast.error('Failed to fetch saved places')
      return []
    }
  }

  async function fetchCollections() {
    try {
      const response = await api.get('/library/collections')
      const collections = response.data
      libraryStore.setCollections(collections)
      return collections
    } catch (error) {
      toast.error('Failed to fetch collections')
      return []
    }
  }

  // Get a collection by ID, fetching from server if needed
  async function fetchCollectionById(id: string): Promise<Collection | null> {
    // First check if it's already in the store
    let collection = libraryStore.getCollectionById(id)

    // If not found and we have no collections, fetch all collections
    if (!collection && libraryStore.collections.length === 0) {
      await fetchCollections()
      collection = libraryStore.getCollectionById(id)
    }

    // If still not found, try to fetch directly from the server
    if (!collection) {
      try {
        const response = await api.get(`/library/collections/${id}`)
        collection = response.data
        // Add to store if found
        if (collection) {
          libraryStore.updateCollection(id, collection)
        }
      } catch (error) {
        toast.error('Collection not found')
        return null
      }
    }

    return collection || null
  }

  // Places operations
  async function savePlace(
    place: UnifiedPlace,
    customName?: string,
    icon = 'map-pin',
    iconColor = '#F43F5E',
  ) {
    if (!place.externalIds || !place.externalIds.osm) {
      toast.error('Cannot save place without an OSM ID')
      return null
    }

    isSaving.value = true

    try {
      const params: CreateSavedPlaceParams = {
        externalIds: place.externalIds,
        name: customName || place.name,
        address: place.address?.formatted,
        icon,
        iconColor,
      }

      const response = await api.post('/library/places', params)
      const savedPlace = response.data

      // Update store
      libraryStore.addSavedPlace(savedPlace)
      toast.success(`Saved ${place.name}`)

      return savedPlace
    } catch (error) {
      toast.error('Failed to save place')
      return null
    } finally {
      isSaving.value = false
    }
  }

  async function updatePlace(id: string, updates: Partial<SavedPlace>) {
    try {
      const response = await api.patch(`/library/places/${id}`, updates)
      const updated = response.data

      // Update store
      libraryStore.updateSavedPlace(id, updated)
      toast.success('Place updated successfully')

      return updated
    } catch (error) {
      toast.error('Failed to update place')
      return null
    }
  }

  async function unsavePlace(id: string, place: SavedPlace) {
    try {
      await api.delete(`/library/places/${id}`)

      // Update store
      libraryStore.removeSavedPlace(id)
      toast.success(`Unsaved ${place.name}`)

      return true
    } catch (error) {
      toast.error('Failed to delete place')
      return false
    }
  }

  // Collections operations
  async function createCollection(params: CreateCollectionParams) {
    try {
      const response = await api.post('/library/collections', params)
      const collection = response.data

      // Update store
      libraryStore.addCollection(collection)
      toast.success('Collection created successfully')

      return collection
    } catch (error) {
      toast.error('Failed to create collection')
      return null
    }
  }

  async function updateCollection(id: string, updates: Partial<Collection>) {
    try {
      const response = await api.patch(`/library/collections/${id}`, updates)
      const updated = response.data

      // Update store
      libraryStore.updateCollection(id, updated)
      toast.success('Collection updated successfully')

      return updated
    } catch (error) {
      toast.error('Failed to update collection')
      return null
    }
  }

  async function deleteCollection(id: string) {
    try {
      await api.delete(`/library/collections/${id}`)

      // Update store
      libraryStore.removeCollection(id)
      toast.success('Collection deleted successfully')

      return true
    } catch (error) {
      toast.error('Failed to delete collection')
      return false
    }
  }

  // Collection-place relationships
  async function addPlaceToCollection(placeId: string, collectionId: string) {
    try {
      const response = await api.post(
        `/library/collections/${collectionId}/places/${placeId}`,
      )

      toast.success('Place added to collection')
      return response.data
    } catch (error) {
      toast.error('Failed to add place to collection')
      return false
    }
  }

  async function removePlaceFromCollection(
    placeId: string,
    collectionId: string,
  ) {
    try {
      const response = await api.delete(
        `/library/collections/${collectionId}/places/${placeId}`,
      )

      toast.success('Place removed from collection')
      return response.data
    } catch (error) {
      toast.error('Failed to remove place from collection')
      return false
    }
  }

  async function fetchPlacesInCollection(collectionId: string) {
    try {
      const response = await api.get(
        `/library/collections/${collectionId}/places`,
      )
      return response.data
    } catch (error) {
      toast.error('Failed to fetch places in collection')
      return []
    }
  }

  // Check if a place is saved
  function isPlaceSaved(place: UnifiedPlace) {
    if (!place.externalIds) return false

    // Check directly instead of using the store's computed property
    return libraryStore.savedPlaces.some(savedPlace => {
      return Object.entries(place.externalIds).some(([provider, id]) => {
        return savedPlace.externalIds[provider] === id
      })
    })
  }

  return {
    // State
    isSaving,

    // Data fetching
    fetchPlaces,
    fetchCollections,
    fetchCollectionById,

    // Place operations
    savePlace,
    updatePlace,
    unsavePlace,

    // Collection operations
    createCollection,
    updateCollection,
    deleteCollection,

    // Collection-place relationships
    addPlaceToCollection,
    removePlaceFromCollection,
    fetchPlacesInCollection,

    // Utilities
    isPlaceSaved,
  }
})
