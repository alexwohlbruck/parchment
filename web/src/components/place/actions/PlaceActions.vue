<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  ShareIcon,
  BookmarkPlusIcon,
  ArrowUpFromDotIcon,
  ArrowDownToDotIcon,
} from 'lucide-vue-next'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import type { Place } from '@/types/place.types'
import { usePlaceService } from '@/services/place.service'
import CollectionPicker from '@/components/library/CollectionPicker.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { type ThemeColor } from '@/lib/utils'
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const props = defineProps<{
  place: Partial<Place>
}>()

const collectionsStore = useCollectionsStore()
const bookmarksService = useBookmarksService()
const { setBookmarkStatus } = usePlaceService()
const { t } = useI18n()

const bookmarkId = computed(() => props.place?.bookmark?.id || null)

// The collections this bookmark currently belongs to. Sourced from the
// place's local state which the picker keeps fresh by emitting
// `collections-changed` after each toggle and `bookmark-created` /
// `bookmark-deleted` for create/delete transitions.
const collectionIds = computed<string[]>(
  () => props.place?.collectionIds ?? [],
)

// The single collection to surface as a colored mini-badge when the
// bookmark lives in exactly one collection. Resolved against the local
// store; null when the count isn't 1 (no badge / count badge instead)
// or the id can't be resolved (stale cache → no badge to avoid flashing
// a placeholder).
const singleCollection = computed(() => {
  if (collectionIds.value.length !== 1) return null
  return collectionsStore.getCollectionById(collectionIds.value[0]) ?? null
})

const hasOsmId = computed(() => {
  return props.place.externalIds?.['osm'] // TODO: Use enum constant
})

// `place.collectionIds` is the source of truth for the badge; sync it
// from each picker event without touching the bookmark identity unless
// the bookmark itself was created or deleted. Cast through `any` —
// the bookmark on the place type is the server-inferred shape (with
// `externalIds: unknown`); the web `Bookmark` constrains it to a
// string record. They're the same row at runtime.
function onCollectionsChanged(ids: string[]) {
  const current = props.place?.bookmark
  if (!current) return
  setBookmarkStatus(current as any, ids)
}

function onBookmarkCreated(bookmark: any, ids: string[]) {
  setBookmarkStatus(bookmark, ids)
}

function onBookmarkDeleted() {
  // Don't close the picker — the user can keep going. Local state
  // flips to "unsaved" so the badge disappears; the picker switches
  // to place-mode internally.
  setBookmarkStatus(null, null)
}
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

      <!-- Bookmark button — single behavior regardless of saved state.
           Always opens the picker. Saved state is communicated through
           the corner badge: count of collections (≥2), the single
           collection's icon (=1), or no badge (unsaved). -->
      <ResponsivePopover
        v-if="hasOsmId"
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
                <BookmarkPlusIcon class="size-4" />

                <!-- Count badge: 2+ collections. Numeric, neutral
                     muted background so it stays legible across themes
                     without competing with the icon for attention. -->
                <span
                  v-if="collectionIds.length >= 2"
                  class="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 bg-primary text-primary-foreground ring-2 ring-background rounded-full text-[10px] font-semibold leading-none flex items-center justify-center"
                >
                  {{ collectionIds.length }}
                </span>

                <!-- Single-collection badge: tiny colored swatch with
                     the collection's actual icon, so the user can tell
                     at a glance which collection holds this bookmark. -->
                <span
                  v-else-if="collectionIds.length === 1 && singleCollection"
                  class="absolute -top-1 -right-1 ring-2 ring-background rounded-sm"
                >
                  <ItemIcon
                    :icon="singleCollection.icon"
                    :icon-pack="singleCollection.iconPack ?? 'lucide'"
                    :color="singleCollection.iconColor as ThemeColor"
                    size="xs"
                  />
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {{
                bookmarkId
                  ? t('library.entities.collections.manage')
                  : t('general.save')
              }}
            </TooltipContent>
          </Tooltip>
        </template>
        <template #content="{ close }">
          <CollectionPicker
            :bookmark="bookmarkId ? ({ id: bookmarkId } as any) : undefined"
            :place="props.place as Place"
            @done="close"
            @collections-changed="onCollectionsChanged"
            @bookmark-created="onBookmarkCreated"
            @bookmark-deleted="onBookmarkDeleted"
          />
        </template>
      </ResponsivePopover>
    </div>
  </TooltipProvider>
</template>
