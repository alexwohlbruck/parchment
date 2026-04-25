<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
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

// Two modes:
//   - `bookmark` — manage which collections an existing bookmark belongs
//     to. Tapping a row toggles membership. Original flow.
//   - `place` — the place isn't bookmarked yet. Tapping a row creates the
//     bookmark in that collection and emits `bookmark-created`; the
//     caller closes the overlay. Used when the user clicks the save
//     button with no last-saved collection on this device.
const props = defineProps<{
  bookmark?: Bookmark
  place?: Place
}>()

const emit = defineEmits<{
  (e: 'bookmark-deleted'): void
  (e: 'bookmark-created', bookmark: Bookmark, collectionIds: string[]): void
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

onMounted(async () => {
  if (collections.value.length === 0) {
    await collectionsService.fetchCollections()
  }
  if (props.bookmark?.id) {
    await fetchCollectionsForBookmark()
  }
})

async function fetchCollectionsForBookmark() {
  if (!props.bookmark || !props.bookmark.id) {
    bookmarkCollectionIds.value = []
    return
  }

  try {
    const response = await api.get(
      `/library/bookmarks/${props.bookmark.id}/collections`,
    )
    bookmarkCollectionIds.value = response.data.map(
      (collection: Collection) => collection.id,
    )
  } catch (error) {
    console.error(
      `[CollectionPicker] Error fetching collections for bookmark ${props.bookmark.id}:`,
      error,
    )
    bookmarkCollectionIds.value = []
  }
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

  // Pin the last-saved collection to the top — it's the button's one-tap
  // target, so keeping it at position zero matches the user's expectation
  // when they open the picker. Rest is recency-sorted.
  const lastSavedId = lastSavedCollectionId.value
  const lastSaved =
    lastSavedId && sourceCollections.find((c) => c.id === lastSavedId)

  const otherCollectionsSorted = sourceCollections
    .filter((c) => c.id !== lastSavedId)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )

  return lastSaved
    ? [lastSaved, ...otherCollectionsSorted]
    : otherCollectionsSorted
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

  if (props.place && !props.bookmark) {
    await saveNewBookmark(collectionId)
    return
  }
  await toggleCollection(collectionId)
}

async function toggleCollection(collectionId: string) {
  if (!props.bookmark || !props.bookmark.id) return

  isTogglingCollection.value = true
  try {
    let newCollectionIds: string[]
    if (bookmarkCollectionIds.value.includes(collectionId)) {
      newCollectionIds = bookmarkCollectionIds.value.filter(
        id => id !== collectionId,
      )
    } else {
      newCollectionIds = [...bookmarkCollectionIds.value, collectionId]
    }

    const updatedBookmark = await bookmarksService.updateBookmark(
      props.bookmark.id,
      { collectionIds: newCollectionIds },
    )

    if (updatedBookmark === undefined) {
      // Handle error case (toast shown by service)
    } else if (updatedBookmark === null) {
      bookmarkCollectionIds.value = []
      emit('bookmark-deleted')
    } else {
      bookmarkCollectionIds.value = newCollectionIds
    }
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

          // Place mode: the bookmark doesn't exist yet. Create it
          // directly in the freshly-made collection and emit so the
          // parent can close the overlay + refresh state.
          if (props.place && !props.bookmark) {
            const bookmark = await bookmarksService.createBookmark(
              props.place,
              [newCollection.id],
            )
            if (bookmark) {
              emit('bookmark-created', bookmark, [newCollection.id])
            }
            return
          }

          if (!props.bookmark?.id) return
          const currentIds = [...bookmarkCollectionIds.value]
          const updatedIds = [...currentIds, newCollection.id]

          const updatedBookmark = await bookmarksService.updateBookmark(
            props.bookmark.id,
            { collectionIds: updatedIds },
          )

          if (updatedBookmark) {
            bookmarkCollectionIds.value = updatedIds
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
            <ItemIcon icon="PlusIcon" color="gray" size="sm" />
          </div>
        </div>
        <span class="grow min-w-0 text-left">
          {{ t('library.actions.createNewCollection') }}
        </span>
      </Button>
    </div>
  </div>
</template>
