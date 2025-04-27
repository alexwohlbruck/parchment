import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import type { SavedPlace } from '@/types/library.types'

export const useSavedPlacesStore = defineStore('savedPlaces', () => {
  const savedPlaces = useStorage<SavedPlace[]>('saved-places', [])

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

  const isPlaceSaved = computed(() => {
    return (externalIds: Record<string, string>) => {
      return savedPlaces.value.some(place => {
        return Object.entries(externalIds).some(([provider, id]) => {
          return place.externalIds[provider] === id
        })
      })
    }
  })

  function navigateToPlace(savedPlace: SavedPlace) {
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

  function setSavedPlaces(places: SavedPlace[]) {
    savedPlaces.value = places
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

  return {
    savedPlaces,
    getSavedPlaceById,
    getSavedPlaceByExternalId,
    isPlaceSaved,
    navigateToPlace,
    setSavedPlaces,
    addSavedPlace,
    updateSavedPlace,
    removeSavedPlace,
  }
})
