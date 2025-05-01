<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { ItemIcon } from '@/components/ui/item-icon'
import { SearchIcon, PlusIcon, CheckIcon, StarIcon } from 'lucide-vue-next'
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
import { getThemeColorClasses, fuzzyFilter, type ThemeColor } from '@/lib/utils'
import { api } from '@/lib/api'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  bookmark: Bookmark
}>()

const emit = defineEmits(['bookmark-deleted'])

const collectionsStore = useCollectionsStore()
const collectionsService = useCollectionsService()
const bookmarksService = useBookmarksService()
const { collections } = storeToRefs(collectionsStore)
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
  await fetchCollectionsForBookmark()
})

async function fetchCollectionsForBookmark() {
  if (!props.bookmark || !props.bookmark.id) {
    console.warn(
      '[CollectionPicker] Attempted fetchCollectionsForBookmark without a valid bookmark ID.',
    )
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
  const sourceCollections = fuzzyFilter(
    collections.value,
    collectionSearchQuery.value,
    {
      keys: ['name', 'description'],
      preserveOrder: true,
    },
  )

  const defaultCollection = sourceCollections.find(c => c.isDefault)

  const otherCollectionsSorted = sourceCollections
    .filter(c => !c.isDefault)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )

  return defaultCollection
    ? [defaultCollection, ...otherCollectionsSorted]
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

async function toggleCollection(collectionId: string) {
  if (!props.bookmark || !props.bookmark.id || isTogglingCollection.value) {
    return
  }

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
          iconColor: formData.iconColor,
          isPublic: formData.isPublic,
        }
        const newCollection = await collectionsService.createCollection(params)

        if (newCollection && newCollection.id) {
          isTogglingCollection.value = true
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
  <div>
    <div
      class="px-2 py-1.5"
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
          class="w-full h-8 pl-7"
          :placeholder="t('library.actions.searchCollections')"
          @keydown="handleKeydown"
        />
      </div>
    </div>

    <div
      v-if="sortedAndFilteredCollections.length > 0"
      class="max-h-[200px] overflow-y-auto px-1"
    >
      <template
        v-for="(collection, index) in sortedAndFilteredCollections"
        :key="collection.id"
      >
        <Button
          variant="ghost"
          class="w-full justify-start h-auto px-2 py-1.5 text-sm font-normal flex items-center gap-2"
          :disabled="isTogglingCollection"
          @click.prevent.stop="toggleCollection(collection.id)"
        >
          <div class="relative mr-0.5">
            <div
              class="size-7 rounded-sm flex items-center justify-center flex-shrink-0"
              :class="getThemeColorClasses(collection.iconColor as ThemeColor)"
            >
              <ItemIcon
                :icon="collection.icon"
                :color="collection.iconColor as ThemeColor"
                size="sm"
              />
            </div>
            <div
              v-if="collection.isDefault"
              class="absolute -top-1 -right-1 bg-yellow-300 dark:bg-yellow-400 text-yellow-800 rounded-full p-[.15rem]"
              title="Default Collection"
            >
              <StarIcon class="size-2.5" stroke-width="3" />
            </div>
          </div>

          <span class="flex-grow min-w-0 text-left">
            {{ getDisplayName(collection) }}
          </span>
          <CheckIcon
            v-if="bookmarkCollectionIds.includes(collection.id)"
            class="size-4 text-primary ml-auto"
          />
        </Button>
        <Separator
          v-if="
            index === 0 &&
            collection.isDefault &&
            sortedAndFilteredCollections.length > 1
          "
          class="my-1"
        />
      </template>
      <Separator class="my-1" />
    </div>

    <div
      v-else-if="collections.length === 0"
      class="px-2 py-4 text-center text-sm text-muted-foreground"
    >
      {{ t('library.empty.noCollections') }}
    </div>

    <div
      v-else-if="collectionSearchQuery"
      class="px-2 py-4 text-center text-sm text-muted-foreground"
    >
      {{
        t('library.empty.searchResults', {
          entityPlural: t('library.entities.collections.title.plural'),
        })
      }}
    </div>

    <div class="px-1">
      <Button
        variant="ghost"
        class="w-full justify-start h-auto px-2 py-1.5 text-sm font-normal flex items-center gap-2"
        @click.prevent.stop="openCreateCollectionDialog"
      >
        <PlusIcon class="size-4 mr-0.5" />
        {{ t('library.actions.createNewCollection') }}
      </Button>
    </div>
  </div>
</template>
