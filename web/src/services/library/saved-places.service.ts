import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useSavedPlacesStore } from '@/stores/library/savedPlaces.store'
import type { UnifiedPlace } from '@/types/unified-place.types'
import type { CreateSavedPlaceParams, SavedPlace } from '@/types/library.types'
import { ref } from 'vue'
import { api } from '@/lib/api'

export const useSavedPlacesService = createSharedComposable(() => {
  const savedPlacesStore = useSavedPlacesStore()
  const isSaving = ref(false) // Keep isSaving here for the savePlace action

  async function getSavedPlaces() {
    try {
      const response = await api.get('/library/places')
      const places = response.data
      savedPlacesStore.setSavedPlaces(places)
      return places
    } catch (error) {
      toast.error('Failed to fetch saved places')
      return []
    }
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

      savedPlacesStore.addSavedPlace(savedPlace)
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
      savedPlacesStore.updateSavedPlace(id, updated)
      toast.success('Place updated successfully')

      return updated
    } catch (error) {
      toast.error('Failed to update place')
      return null
    }
  }

  async function unsavePlace(id: string, placeName: string) {
    try {
      await api.delete(`/library/places/${id}`)

      savedPlacesStore.removeSavedPlace(id)
      toast.success(`Unsaved ${placeName}`)

      return true
    } catch (error) {
      toast.error('Failed to unsave place')
      return false
    }
  }

  function isPlaceSaved(place: UnifiedPlace) {
    if (!place.externalIds) return false

    return savedPlacesStore.savedPlaces.some(savedPlace => {
      return Object.entries(place.externalIds).some(([provider, id]) => {
        return savedPlace.externalIds[provider] === id
      })
    })
  }

  return {
    isSaving,
    getSavedPlaces,
    savePlace,
    updatePlace,
    unsavePlace,
    isPlaceSaved,
  }
})
