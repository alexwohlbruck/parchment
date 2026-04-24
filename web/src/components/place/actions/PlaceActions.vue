<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  ShareIcon,
  BookmarkIcon,
  FolderPlusIcon,
  PlusIcon,
  ArrowUpFromDotIcon,
  ArrowDownToDotIcon,
} from 'lucide-vue-next'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import type { Place } from '@/types/place.types'
import { usePlaceService } from '@/services/place.service'
import CollectionPicker from '@/components/library/CollectionPicker.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { getThemeColorClasses, type ThemeColor } from '@/lib/utils'
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { storeToRefs } from 'pinia'

const props = defineProps<{
  place: Partial<Place>
}>()

const collectionsStore = useCollectionsStore()
const collectionsService = useCollectionsService()
const bookmarksService = useBookmarksService()
const { setBookmarkStatus } = usePlaceService()
const { t } = useI18n()
const { collections, lastSavedCollectionId } = storeToRefs(collectionsStore)

// One-tap save target. The primary choice is the collection the user most
// recently saved to on this device; falling back to the most recently
// updated writable collection when nothing is pinned yet (fresh account,
// cleared storage, or the pinned collection got deleted). This preserves
// the click-once-to-save / click-again-to-manage flow for a brand-new
// user — the picker only appears after the bookmark exists. Null only
// when the library is genuinely empty (no writable collection available).
const saveTarget = computed(() => {
  const lastId = lastSavedCollectionId.value
  if (lastId) {
    const pinned = collectionsStore.getCollectionById(lastId)
    if (pinned && isWritable(pinned)) return pinned
  }
  const writable = collections.value.filter(isWritable)
  if (writable.length === 0) return null
  return writable
    .slice()
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0]
})

function isWritable(c: { role?: string | null }) {
  return !c.role || c.role === 'owner' || c.role === 'editor'
}

const bookmarkId = computed(() => {
  return props.place?.bookmark?.id || null
})

const isSaved = computed(() => {
  return !!props.place?.bookmark
})

const saveTooltip = computed(() => {
  const c = saveTarget.value
  if (!c) return t('general.save')
  return t('library.actions.saveToCollection', {
    collection: collectionsService.getCollectionDisplayName(c),
  })
})

async function quickSave() {
  if (!props.place?.id) return
  const target = saveTarget.value
  if (!target) return
  const newBookmark = await bookmarksService.createBookmark(
    props.place as Place,
    [target.id],
  )
  if (newBookmark) {
    setBookmarkStatus(newBookmark, [target.id])
  }
}

const hasOsmId = computed(() => {
  return props.place.externalIds?.['osm'] // TODO: Use enum constant
})
</script>

<template>
  <TooltipProvider :delay-duration="200">
    <div class="flex gap-2">
      <Button class="flex-1" @click="$emit('directions')">
        <ArrowDownToDotIcon class="mr-2 size-4 -rotate-90" />
        {{ t('directions.directions') }}
      </Button>
      <Button class="flex-1" variant="outline" @click="$emit('directionsFrom')">
        <ArrowUpFromDotIcon class="mr-2 size-4 rotate-90" />
        {{ t('directions.planRoute') }}
      </Button>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button size="icon" variant="outline" @click="$emit('share')">
            <ShareIcon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ t('general.share') }}</TooltipContent>
      </Tooltip>
      <template v-if="hasOsmId">
        <!-- Already saved: open the picker to manage which collections this
             bookmark belongs to. Unchanged flow. -->
        <ResponsivePopover
          v-if="isSaved && bookmarkId"
          align="end"
          desktop-content-class="w-auto px-0 py-1 min-w-[240px]"
          :peek-height="'400px'"
          modal
          :z-index-offset="10"
          fit-content
          mobile-content-class="pt-5 pb-2 px-1"
        >
          <template #trigger>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button size="icon" variant="outline">
                  <FolderPlusIcon class="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {{ t('library.entities.collections.manage') }}
              </TooltipContent>
            </Tooltip>
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

        <!-- Unsaved + a resolvable target (pinned last-saved, or the most
             recently updated writable collection as a fallback): one-tap
             save. Button inherits the collection's theme color; the "+"
             badge signals that clicking adds to that collection. A second
             click after saving lands in the manage-picker branch above. -->
        <Tooltip v-else-if="saveTarget">
          <TooltipTrigger as-child>
            <Button
              size="icon"
              variant="outline"
              class="relative"
              :class="
                getThemeColorClasses(
                  (saveTarget.iconColor as ThemeColor) || 'blue',
                )
              "
              @click="quickSave()"
            >
              <ItemIcon
                :icon="saveTarget.icon"
                :color="saveTarget.iconColor as ThemeColor"
                size="sm"
                plain
              />
              <span
                class="absolute -top-1 -right-1 bg-background text-foreground ring-1 ring-border rounded-full p-[1px]"
              >
                <PlusIcon class="size-2.5" stroke-width="3" />
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ saveTooltip }}</TooltipContent>
        </Tooltip>

        <!-- No writable collection exists yet (empty library). Fall back to
             opening the picker so the user can create one and save in a
             single flow. -->
        <ResponsivePopover
          v-else
          align="end"
          desktop-content-class="w-auto px-0 py-1 min-w-[240px]"
          :peek-height="'400px'"
          modal
          :z-index-offset="10"
          fit-content
          mobile-content-class="pt-5 pb-2 px-1"
        >
          <template #trigger>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button size="icon" variant="outline" class="relative">
                  <BookmarkIcon class="size-4" />
                  <span
                    class="absolute -top-1 -right-1 bg-background text-foreground ring-1 ring-border rounded-full p-[1px]"
                  >
                    <PlusIcon class="size-2.5" stroke-width="3" />
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('general.save') }}</TooltipContent>
            </Tooltip>
          </template>
          <template #content="{ close }">
            <CollectionPicker
              :place="props.place as Place"
              @bookmark-created="
                (bookmark, collectionIds) => {
                  setBookmarkStatus(bookmark, collectionIds)
                  close()
                }
              "
            />
          </template>
        </ResponsivePopover>
      </template>
    </div>
  </TooltipProvider>
</template>
