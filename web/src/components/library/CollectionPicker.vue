<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { ItemIcon } from '@/components/ui/item-icon'
import { SearchIcon, CheckIcon, ClockIcon } from 'lucide-vue-next'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { useAppService } from '@/services/app.service'
import CollectionForm from '@/components/library/CollectionForm.vue'
import { storeToRefs } from 'pinia'
import type {
  Bookmark,
  CreateCollectionParams,
  Collection,
} from '@/types/library.types'
import type { Place } from '@/types/place.types'
import { getThemeColorClasses, fuzzyFilter, type ThemeColor } from '@/lib/utils'
import { api } from '@/lib/api'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'

// Drives whichever mode applies for the given props at click time:
//   - When a `bookmark` is in play, taps toggle collection membership.
//   - When only `place` is in play (no bookmark yet), the first tap
//     creates the bookmark in the picked collection.
//   - If a bookmark gets removed from its last collection mid-session,
//     the server deletes it and we transparently swap to `place` mode
//     so further taps re-create it under whichever collection the user
//     picks next. Picker stays open the whole time — closing is
//     explicit via the Done button.
const props = defineProps<{
  bookmark?: Bookmark
  place?: Place
}>()

const emit = defineEmits<{
  (e: 'done'): void
  (e: 'bookmark-deleted'): void
  (e: 'bookmark-created', bookmark: Bookmark, collectionIds: string[]): void
  (e: 'collections-changed', collectionIds: string[]): void
}>()

const collectionsStore = useCollectionsStore()
const collectionsService = useCollectionsService()
const bookmarksService = useBookmarksService()
const { collections, lastSavedCollectionId } = storeToRefs(collectionsStore)
const { t } = useI18n()
const appService = useAppService()
const collectionSearchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const isTogglingCollection = ref(false)
const bookmarkCollectionIds = ref<string[]>([])

// Local mirror of the bookmark prop. Lets us flip into place-mode on
// the spot when the user empties the bookmark to zero collections —
// the parent's prop update lands a tick later but we don't want to
// wait or block the next click on stale state.
const currentBookmark = ref<Bookmark | undefined>(props.bookmark)

watch(
  () => props.bookmark?.id,
  async (id, oldId) => {
    if (id !== oldId) {
      currentBookmark.value = props.bookmark
      if (id) {
        await fetchCollectionsForBookmark()
      } else {
        bookmarkCollectionIds.value = []
      }
    }
  },
)

onMounted(async () => {
  if (collections.value.length === 0) {
    await collectionsService.fetchCollections()
  }
  // Snapshot the order AFTER fetchCollections so a freshly-loaded list
  // gets indexed; otherwise an empty store would freeze to an empty
  // map and every row would land in the "appended at the bottom"
  // bucket.
  frozenOrder.value = buildFrozenOrder()
  if (currentBookmark.value?.id) {
    await fetchCollectionsForBookmark()
  }
})

async function fetchCollectionsForBookmark() {
  const id = currentBookmark.value?.id
  if (!id) {
    bookmarkCollectionIds.value = []
    return
  }

  try {
    const response = await api.get(
      `/library/bookmarks/${id}/collections`,
    )
    const ids = response.data.map((collection: Collection) => collection.id)
    bookmarkCollectionIds.value = ids
    // Re-sync the parent's cached collection set in case it drifted —
    // the badge on the bookmark button reads from there, and a stale
    // count would mislead until the next toggle.
    emit('collections-changed', ids)
  } catch (error) {
    console.error(
      `[CollectionPicker] Error fetching collections for bookmark ${id}:`,
      error,
    )
    bookmarkCollectionIds.value = []
  }
}

// Snapshot the sort order at mount time and freeze it for the lifetime
// of the picker. Without this, every collection write (toggling
// membership, creating a new collection) bumps `updatedAt` and the
// recency-sorted list re-shuffles under the user's finger — the row
// they were about to tap moves before the click lands. The freeze gets
// reset whenever the picker is mounted again (i.e. opened).
const frozenOrder = ref<Map<string, number>>(new Map())

function buildFrozenOrder(): Map<string, number> {
  const writable = collections.value.filter(
    (c) => !c.role || c.role === 'owner' || c.role === 'editor',
  )
  const lastSavedId = lastSavedCollectionId.value
  const ordered = writable
    .slice()
    .sort((a, b) => {
      // Pin the last-saved collection to the top — it's the most likely
      // target on first save and matches the badge in the trigger.
      if (a.id === lastSavedId) return -1
      if (b.id === lastSavedId) return 1
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  return new Map(ordered.map((c, i) => [c.id, i]))
}

const sortedAndFilteredCollections = computed(() => {
  // Only offer collections the caller can actually write to. Viewer-role
  // shared collections are read-only — showing them here just sets the
  // user up for a 403 toast on click.
  const writableCollections = collections.value.filter(
    (c) => !c.role || c.role === 'owner' || c.role === 'editor',
  )

  const sourceCollections = fuzzyFilter(
    writableCollections,
    collectionSearchQuery.value,
    {
      keys: ['name', 'description'],
      preserveOrder: true,
    },
  )

  // Apply the frozen order. Collections that didn't exist when the
  // picker opened (e.g. one the user just created via the dialog) get
  // appended at the bottom in store order — they weren't in the
  // snapshot's index, so `Infinity` puts them last and stable.
  const order = frozenOrder.value
  const sorted = sourceCollections.slice().sort((a, b) => {
    const ai = order.get(a.id) ?? Infinity
    const bi = order.get(b.id) ?? Infinity
    return ai - bi
  })

  return sorted
})

function getDisplayName(collection: Collection): string {
  return collectionsService.getCollectionDisplayName(collection)
}

function preventPropagation(event: Event) {
  event.stopPropagation()
}

function handleKeydown(event: KeyboardEvent) {
  const preventedKeys = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', ' ']
  if (preventedKeys.includes(event.key)) {
    event.stopPropagation()
  }
}

async function onCollectionClick(collectionId: string) {
  if (isTogglingCollection.value) return

  if (currentBookmark.value?.id) {
    await toggleCollection(collectionId)
  } else if (props.place) {
    await saveNewBookmark(collectionId)
  }
}

async function toggleCollection(collectionId: string) {
  const id = currentBookmark.value?.id
  if (!id) return

  isTogglingCollection.value = true
  try {
    const newCollectionIds = bookmarkCollectionIds.value.includes(collectionId)
      ? bookmarkCollectionIds.value.filter((cid) => cid !== collectionId)
      : [...bookmarkCollectionIds.value, collectionId]

    const updatedBookmark = await bookmarksService.updateBookmark(id, {
      collectionIds: newCollectionIds,
    })

    if (updatedBookmark === undefined) {
      // Service-level error already toasted; leave local state alone so
      // the user can retry on the same row without it looking checked.
      return
    }

    if (updatedBookmark === null) {
      // Server deleted the bookmark (zero collections left). Don't close
      // the picker — flip to place-mode locally so the next tap creates
      // a fresh bookmark wherever the user points.
      bookmarkCollectionIds.value = []
      currentBookmark.value = undefined
      emit('bookmark-deleted')
      return
    }

    bookmarkCollectionIds.value = newCollectionIds
    emit('collections-changed', newCollectionIds)
  } catch (error) {
    console.error('[CollectionPicker] Error toggling collection:', error)
  } finally {
    isTogglingCollection.value = false
  }
}

async function saveNewBookmark(collectionId: string) {
  if (!props.place) return
  isTogglingCollection.value = true
  try {
    const bookmark = await bookmarksService.createBookmark(props.place, [
      collectionId,
    ])
    if (bookmark) {
      currentBookmark.value = bookmark
      bookmarkCollectionIds.value = [collectionId]
      emit('bookmark-created', bookmark, [collectionId])
    }
  } finally {
    isTogglingCollection.value = false
  }
}

function openCreateCollectionDialog() {
  appService
    .componentDialog({
      component: CollectionForm,
      title: t('library.dialog.createCollection.title'),
      description: t('library.dialog.createCollection.description'),
      continueText: t('general.create'),
      cancelText: t('general.cancel'),
      props: {},
    })
    .then(async formData => {
      if (!formData) return

      try {
        const params: CreateCollectionParams = {
          name: formData.name,
          ...(formData.description
            ? { description: formData.description }
            : {}),
          icon: formData.icon,
          iconPack: formData.iconPack,
          iconColor: formData.iconColor,
          isPublic: formData.isPublic,
        }
        const newCollection = await collectionsService.createCollection(params)

        if (newCollection && newCollection.id) {
          isTogglingCollection.value = true

          // Place mode: there's no bookmark yet, so the freshly-made
          // collection becomes the very first one for this place. Same
          // codepath as picking an existing collection in place-mode.
          if (!currentBookmark.value?.id && props.place) {
            const bookmark = await bookmarksService.createBookmark(
              props.place,
              [newCollection.id],
            )
            if (bookmark) {
              currentBookmark.value = bookmark
              bookmarkCollectionIds.value = [newCollection.id]
              emit('bookmark-created', bookmark, [newCollection.id])
            }
            return
          }

          const id = currentBookmark.value?.id
          if (!id) return
          const updatedIds = [...bookmarkCollectionIds.value, newCollection.id]

          const updatedBookmark = await bookmarksService.updateBookmark(id, {
            collectionIds: updatedIds,
          })

          if (updatedBookmark) {
            bookmarkCollectionIds.value = updatedIds
            emit('collections-changed', updatedIds)
          } else {
            await fetchCollectionsForBookmark()
          }
        }
      } catch (error) {
        console.error(
          '[CollectionPicker] Error creating collection or adding bookmark:',
          error,
        )
      } finally {
        isTogglingCollection.value = false
      }
    })
}
</script>

<template>
  <div class="flex flex-col gap-2 py-2">
    <h2 class="px-4 text-base font-semibold">
      {{ t('library.actions.addToCollection') }}
    </h2>
    <div
      class="px-4"
      @click.stop="preventPropagation"
      @keydown.stop="handleKeydown"
    >
      <div class="relative">
        <SearchIcon
          class="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
        />
        <Input
          ref="searchInputRef"
          v-model="collectionSearchQuery"
          class="w-full md:h-9 pl-7"
          :placeholder="t('library.actions.searchCollections')"
          @keydown="handleKeydown"
        />
      </div>
    </div>

    <div
      v-if="sortedAndFilteredCollections.length > 0"
      class="max-h-[240px] overflow-y-auto px-2 flex flex-col gap-0.5"
    >
      <template
        v-for="collection in sortedAndFilteredCollections"
        :key="collection.id"
      >
        <Button
          variant="ghost"
          class="w-full justify-start h-auto min-h-11 px-2 py-2 text-sm font-normal flex items-center gap-2"
          :disabled="isTogglingCollection"
          @click.prevent.stop="onCollectionClick(collection.id)"
        >
          <div class="relative mr-0.5">
            <div
              class="size-7 rounded-sm flex items-center justify-center shrink-0"
              :class="getThemeColorClasses(collection.iconColor as ThemeColor)"
            >
              <ItemIcon
                :icon="collection.icon"
                :icon-pack="collection.iconPack ?? 'lucide'"
                :color="collection.iconColor as ThemeColor"
                size="sm"
              />
            </div>
            <div
              v-if="collection.id === lastSavedCollectionId"
              class="absolute -top-1 -right-1 bg-muted text-muted-foreground ring-2 ring-background rounded-full p-[.15rem]"
              :title="t('library.entities.collections.lastSaved')"
            >
              <ClockIcon class="size-2.5" stroke-width="3" />
            </div>
          </div>

          <span class="grow min-w-0 text-left">
            {{ getDisplayName(collection) }}
          </span>
          <CheckIcon
            v-if="bookmarkCollectionIds.includes(collection.id)"
            class="size-4 text-primary ml-auto"
          />
        </Button>
      </template>
    </div>

    <div
      v-else-if="collections.length === 0"
      class="px-4 py-4 text-center text-sm text-muted-foreground"
    >
      {{ t('library.empty.noCollections') }}
    </div>

    <div
      v-else-if="collectionSearchQuery"
      class="px-4 py-4 text-center text-sm text-muted-foreground"
    >
      {{
        t('library.empty.searchResults', {
          entityPlural: t('library.entities.collections.title.plural'),
        })
      }}
    </div>

    <Separator />

    <div class="px-2">
      <Button
        variant="ghost"
        class="w-full justify-start h-auto min-h-11 px-2 py-2 text-sm font-normal flex items-center gap-2"
        @click.prevent.stop="openCreateCollectionDialog"
      >
        <div class="relative mr-0.5">
          <div
            class="size-7 rounded-sm flex items-center justify-center shrink-0 bg-muted"
          >
            <ItemIcon icon="PlusIcon" color="neutral" size="sm" />
          </div>
        </div>
        <span class="grow min-w-0 text-left">
          {{ t('library.actions.createNewCollection') }}
        </span>
      </Button>
    </div>

    <Separator />

    <div class="px-2 pb-1">
      <Button
        class="w-full"
        size="sm"
        @click.prevent.stop="emit('done')"
      >
        {{ t('general.done') }}
      </Button>
    </div>
  </div>
</template>
