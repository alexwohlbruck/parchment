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
import type { Place } from '@/types/place.types'
import type { Collection } from '@/types/library.types'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { usePlaceService } from '@/services/place.service'
import CollectionPicker from '@/components/library/CollectionPicker.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { type ThemeColor } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const props = defineProps<{
  place: Place
}>()

const collectionsService = useCollectionsService()
const bookmarksService = useBookmarksService()
const bookmarksStore = useBookmarksStore()
const { setBookmarkStatus } = usePlaceService()
const defaultCollection = ref<Collection | null>(null)

onMounted(async () => {
  defaultCollection.value = await collectionsService.fetchDefaultCollection()
})

const bookmarkId = computed(() => {
  return props.place?.bookmark?.id || null
})

const isSaved = computed(() => {
  return !!props.place?.bookmark
})

async function createBookmark() {
  if (!defaultCollection.value) {
    console.error('Default collection not loaded, cannot save place.')
    return
  }
  const newBookmark = await bookmarksService.createBookmark(props.place, [
    defaultCollection.value.id,
  ])

  if (newBookmark) {
    setBookmarkStatus(newBookmark, [defaultCollection.value.id])
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
    <Popover v-if="isSaved && bookmarkId">
      <PopoverTrigger as-child>
        <Button size="icon" variant="outline" title="Manage collections">
          <FolderPlusIcon class="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" class="w-auto px-0 py-1 min-w-[240px]">
        <CollectionPicker
          :bookmark="{ id: bookmarkId } as any"
          @bookmark-deleted="setBookmarkStatus(null, null)"
        />
      </PopoverContent>
    </Popover>
    <Button
      v-else
      size="icon"
      variant="outline"
      @click="createBookmark()"
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
