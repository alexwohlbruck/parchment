<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import {
  NavigationIcon,
  ShareIcon,
  BookmarkIcon,
  Check,
  FolderPlusIcon,
} from 'lucide-vue-next'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { useAppService } from '@/services/app.service'
import type { UnifiedPlace } from '@/types/unified-place.types'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import CollectionPicker from '@/components/library/CollectionPicker.vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const props = defineProps<{
  place: UnifiedPlace
}>()

const collectionsService = useCollectionsService()
const bookmarksService = useBookmarksService()
const bookmarksStore = useBookmarksStore()

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

function handleCollectionToggle(collectionId: string) {
  // Already handled in CollectionPicker component
}

function handleCreateCollection() {
  console.log('Create new collection')
}
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
    <DropdownMenu v-if="isSaved && bookmarkId">
      <DropdownMenuTrigger as-child>
        <Button size="icon" variant="outline" title="Manage collections">
          <FolderPlusIcon class="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="min-w-[240px]">
        <CollectionPicker
          :place="{ id: bookmarkId } as any"
          @toggle-collection="handleCollectionToggle"
          @create-collection="handleCreateCollection"
        />
      </DropdownMenuContent>
    </DropdownMenu>
    <Button
      v-else
      size="icon"
      variant="outline"
      @click="savePlace()"
      title="Save place"
    >
      <BookmarkIcon class="h-4 w-4" />
    </Button>
  </div>
</template>
