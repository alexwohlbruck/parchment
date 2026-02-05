<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  ShareIcon,
  BookmarkIcon,
  FolderPlusIcon,
  ArrowUpFromDotIcon,
  ArrowDownToDotIcon,
} from 'lucide-vue-next'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import type { Place } from '@/types/place.types'
import type { Collection } from '@/types/library.types'
import { usePlaceService } from '@/services/place.service'
import CollectionPicker from '@/components/library/CollectionPicker.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { type ThemeColor } from '@/lib/utils'
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'

const props = defineProps<{
  place: Partial<Place>
}>()

const collectionsService = useCollectionsService()
const bookmarksService = useBookmarksService()
const { setBookmarkStatus } = usePlaceService()
const { t } = useI18n()
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

const hasOsmId = computed(() => {
  return props.place.externalIds?.['osm'] // TODO: Use enum constant
})
</script>

<template>
  <div class="flex gap-2">
    <Button class="flex-1" @click="$emit('directions')">
      <ArrowDownToDotIcon class="mr-2 size-4 -rotate-90" />
      {{ t('directions.directions') }}
    </Button>
    <Button class="flex-1" variant="outline" @click="$emit('directionsFrom')">
      <ArrowUpFromDotIcon class="mr-2 size-4 rotate-90" />
      {{ t('directions.planRoute') }}
    </Button>
    <Button
      size="icon"
      variant="outline"
      @click="$emit('share')"
      :title="t('general.share')"
    >
      <ShareIcon class="size-4" />
    </Button>
    <template v-if="hasOsmId">
      <ResponsivePopover
        v-if="isSaved && bookmarkId"
        align="end"
        desktop-content-class="w-auto px-0 py-1 min-w-[240px]"
        :peek-height="'400px'"
        modal
        :z-index-offset="10"
        mobile-content-class="pt-0 px-1"
      >
        <template #trigger>
          <Button
            size="icon"
            variant="outline"
            :title="t('library.entities.collections.manage')"
          >
            <FolderPlusIcon class="size-4" />
          </Button>
        </template>
        <template #content="{ close }">
          <CollectionPicker
            :bookmark="{ id: bookmarkId } as any"
            @bookmark-deleted="
              () => {
                setBookmarkStatus(null, null)
                close()
              }
            "
          />
        </template>
      </ResponsivePopover>
      <Button
        v-else
        size="icon"
        variant="outline"
        @click="createBookmark()"
        :title="t('general.save')"
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
    </template>
  </div>
</template>
