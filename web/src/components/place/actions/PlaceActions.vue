<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
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
import type { Collection } from '@/types/library.types'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import CollectionPicker from '@/components/library/CollectionPicker.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { type ThemeColor } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const props = defineProps<{
  place: UnifiedPlace
}>()

const collectionsService = useCollectionsService()
const collectionsStore = useCollectionsStore()
const bookmarksService = useBookmarksService()
const bookmarksStore = useBookmarksStore()
const defaultCollection = ref<Collection | null>(null)

onMounted(async () => {
  defaultCollection.value = await collectionsService.fetchDefaultCollection()
})

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

  if (!defaultCollection.value) {
    defaultCollection.value = await collectionsService.fetchDefaultCollection()
  }

  if (defaultCollection.value) {
    await collectionsService.addPlaceToCollection(
      bookmark.id,
      defaultCollection.value.id,
    )
  }
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
        <CollectionPicker :place="{ id: bookmarkId } as any" />
      </DropdownMenuContent>
    </DropdownMenu>
    <Button
      v-else
      size="icon"
      variant="outline"
      @click="savePlace()"
      title="Save place"
    >
      <ItemIcon
        v-if="defaultCollection"
        :icon="defaultCollection.icon"
        :color="defaultCollection.iconColor as ThemeColor"
        size="sm"
        plain
      />
      <BookmarkIcon v-else class="h-4 w-4" />
    </Button>
  </div>
</template>
