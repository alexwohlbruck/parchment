<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { NavigationIcon, ShareIcon, BookmarkIcon, Check } from 'lucide-vue-next'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { useAppService } from '@/services/app.service'
import type { UnifiedPlace } from '@/types/unified-place.types'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'

const props = defineProps<{
  place: UnifiedPlace
}>()

const collectionsService = useCollectionsService()
const bookmarksService = useBookmarksService()
const bookmarksStore = useBookmarksStore()
const { toast } = useAppService()

const bookmarkId = computed(() => {
  if (!props.place.externalIds) return null

  const bookmark = bookmarksStore.bookmarks.find(bookmark => {
    return Object.entries(props.place.externalIds).some(([provider, id]) => {
      return bookmark.externalIds[provider] === id
    })
  })

  return bookmark?.id || null
})

const isSaved = computed(() => {
  return bookmarkId.value !== null
})

async function savePlace() {
  const bookmark = await bookmarksService.savePlace(props.place)
  if (!bookmark) return

  const defaultCollection = await collectionsService.fetchDefaultCollection()
  if (!defaultCollection) return

  await collectionsService.addPlaceToCollection(
    bookmark.id,
    defaultCollection.id,
  )
}

async function unsavePlace() {
  if (!bookmarkId.value) return

  const defaultCollection = await collectionsService.fetchDefaultCollection()
  if (!defaultCollection) return

  await collectionsService.removePlaceFromCollection(
    bookmarkId.value,
    defaultCollection.id,
  )

  await bookmarksService.unsavePlace(bookmarkId.value, props.place.name)
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
