<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { NavigationIcon, ShareIcon, BookmarkIcon, Check } from 'lucide-vue-next'
import { useCollectionsService } from '@/services/library/collections.service'
import { useSavedPlacesService } from '@/services/library/saved-places.service'
import { useAppService } from '@/services/app.service'
import type { UnifiedPlace } from '@/types/unified-place.types'
import { useSavedPlacesStore } from '@/stores/library/savedPlaces.store'

const props = defineProps<{
  place: UnifiedPlace
}>()

const collectionsService = useCollectionsService()
const savedPlacesService = useSavedPlacesService()
const savedPlacesStore = useSavedPlacesStore()
const { toast } = useAppService()

// Track the saved place ID so we can use it when unsaving
const savedPlaceId = computed(() => {
  // Find the saved place that matches this place's external IDs
  if (!props.place.externalIds) return null

  // Look through saved places to find one with matching external IDs
  const savedPlace = savedPlacesStore.savedPlaces.find(savedPlace => {
    return Object.entries(props.place.externalIds).some(([provider, id]) => {
      return savedPlace.externalIds[provider] === id
    })
  })

  return savedPlace?.id || null
})

const isSaved = computed(() => {
  return savedPlaceId.value !== null
})

async function savePlace() {
  // First save the place using the saved places service
  const savedPlace = await savedPlacesService.savePlace(props.place)
  if (!savedPlace) return

  // Get the default collection
  const defaultCollection = await collectionsService.fetchDefaultCollection()
  if (!defaultCollection) return

  // Add the place to the default collection
  await collectionsService.addPlaceToCollection(
    savedPlace.id,
    defaultCollection.id,
  )
}

async function unsavePlace() {
  if (!savedPlaceId.value) return

  // Get the default collection
  const defaultCollection = await collectionsService.fetchDefaultCollection()
  if (!defaultCollection) return

  // Remove the place from the default collection first
  await collectionsService.removePlaceFromCollection(
    savedPlaceId.value,
    defaultCollection.id,
  )

  // Then unsave the place - this will show a single toast
  await savedPlacesService.unsavePlace(savedPlaceId.value, props.place.name)
}

const emit = defineEmits<{
  (e: 'directions'): void
  (e: 'share'): void
}>()
</script>

<template>
  <div class="flex gap-2">
    <Button class="flex-1" @click="$emit('directions')">
      <NavigationIcon class="mr-2 h-4 w-4" />
      Directions
    </Button>
    <Button variant="outline" class="flex-1" @click="$emit('share')">
      <ShareIcon class="mr-2 h-4 w-4" />
      Share
    </Button>
    <Button
      size="icon"
      variant="outline"
      @click="isSaved ? unsavePlace() : savePlace()"
      title="Save place"
    >
      <BookmarkIcon v-if="!isSaved" class="h-4 w-4" />
      <Check v-else class="h-4 w-4" />
    </Button>
  </div>
</template>
