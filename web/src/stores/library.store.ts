import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import type { SavedPlace, Collection } from '@/types/library.types'

export const useLibraryStore = defineStore('library', () => {
  // State
  const savedPlaces = useStorage<SavedPlace[]>('saved-places', [])
  const collections = useStorage<Collection[]>('collections', [])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const getSavedPlaceById = computed(() => {
    return (id: string) => savedPlaces.value.find(place => place.id === id)
  })

  const getSavedPlaceByExternalId = computed(() => {
    return (provider: string, externalId: string) => {
      return savedPlaces.value.find(place => {
        return place.externalIds[provider] === externalId
      })
    }
  })

  const getCollectionById = computed(() => {
    return (id: string) =>
      collections.value.find(collection => collection.id === id)
  })

  // Check if a place is saved
  const isPlaceSaved = computed(() => {
    return (externalIds: Record<string, string>) => {
      // Check if any of the saved places has at least one matching external ID
      return savedPlaces.value.some(place => {
        return Object.entries(externalIds).some(([provider, id]) => {
          return place.externalIds[provider] === id
        })
      })
    }
  })

  // Router navigation helper
  function navigateToPlace(savedPlace: SavedPlace) {
    // For places with an OSM ID, navigate to the regular place view
    const osmId = savedPlace.externalIds.osm
    const osmType = savedPlace.externalIds.osmType || 'node'

    if (osmId && osmType) {
      return {
        name: 'Place',
        params: { type: osmType, id: osmId },
      }
    }

    return null
  }

  // State mutations
  function setSavedPlaces(places: SavedPlace[]) {
    savedPlaces.value = places
  }

  function setCollections(newCollections: Collection[]) {
    collections.value = newCollections
  }

  function addSavedPlace(place: SavedPlace) {
    savedPlaces.value = [...savedPlaces.value, place]
  }

  function updateSavedPlace(id: string, updatedPlace: SavedPlace) {
    const index = savedPlaces.value.findIndex(place => place.id === id)
    if (index !== -1) {
      savedPlaces.value[index] = updatedPlace
    }
  }

  function removeSavedPlace(id: string) {
    savedPlaces.value = savedPlaces.value.filter(place => place.id !== id)
  }

  function addCollection(collection: Collection) {
    collections.value = [...collections.value, collection]
  }

  function updateCollection(id: string, updatedCollection: Collection) {
    const index = collections.value.findIndex(
      collection => collection.id === id,
    )
    if (index !== -1) {
      collections.value[index] = updatedCollection
    }
  }

  function removeCollection(id: string) {
    collections.value = collections.value.filter(
      collection => collection.id !== id,
    )
  }

  return {
    // State
    savedPlaces,
    collections,
    isLoading,
    error,

    // Getters
    getSavedPlaceById,
    getSavedPlaceByExternalId,
    getCollectionById,
    isPlaceSaved,
    navigateToPlace,

    // State mutations
    setSavedPlaces,
    setCollections,
    addSavedPlace,
    updateSavedPlace,
    removeSavedPlace,
    addCollection,
    updateCollection,
    removeCollection,
  }
})
