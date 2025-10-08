<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { SearchIcon, ArrowUpDownIcon } from 'lucide-vue-next'
import BookmarkCard from '@/components/library/BookmarkCard.vue'
import { fuzzyFilter } from '@/lib/utils'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import type { Bookmark } from '@/types/library.types'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'

const props = defineProps<{
  bookmarks: Bookmark[]
  loading?: boolean
  collectionId?: string
}>()

const { t } = useI18n()
const collectionsService = useCollectionsService()
const bookmarksService = useBookmarksService()
const localBookmarks = ref<Bookmark[]>([...props.bookmarks])

const searchQuery = ref('')
const sortBy = ref<'name' | 'createdAt' | 'updatedAt'>('updatedAt')
const sortOrder = ref<'asc' | 'desc'>('desc')

watch(
  () => props.bookmarks,
  newBookmarks => {
    localBookmarks.value = [...newBookmarks]
  },
  { deep: true },
)

const filteredBookmarks = computed(() => {
  let result = searchQuery.value
    ? fuzzyFilter(localBookmarks.value, searchQuery.value, {
        keys: ['name', 'presetType', 'address'],
        preserveOrder: true,
      })
    : localBookmarks.value

  result = [...result].sort((a, b) => {
    let comparison = 0

    if (sortBy.value === 'name') {
      comparison = a.name.localeCompare(b.name)
    } else if (sortBy.value === 'updatedAt') {
      comparison =
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    } else if (sortBy.value === 'createdAt') {
      comparison =
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    }

    return sortOrder.value === 'asc' ? comparison : -comparison
  })

  return result
})

function toggleSortOrder() {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
}

function setSortBy(field: 'name' | 'createdAt' | 'updatedAt') {
  if (sortBy.value === field) {
    toggleSortOrder()
  } else {
    sortBy.value = field
    sortOrder.value = field === 'name' ? 'asc' : 'desc'
  }
}

async function handleAddToCollection(bookmark: Bookmark) {
  console.log('Bookmark added to collection:', bookmark.name)
  // TODO: Re-fetch data or update UI if necessary after CollectionPicker interaction
  // For now, CollectionPicker handles the API call and updates its internal state.
  // We might need to refresh this list's data depending on UX.
}

// Handle bookmark removed from the *current* collection context
async function handleRemoveFromCollection(bookmark: Bookmark) {
  if (props.collectionId) {
    const success = await bookmarksService.removeBookmark(
      bookmark.id,
      [props.collectionId], // Only remove from this specific collection context
      bookmark.name, // Pass name for potential toast message
    )
    if (success) {
      // Optimistically remove from the local list for this view
      localBookmarks.value = localBookmarks.value.filter(
        b => b.id !== bookmark.id,
      )
    }
  } else {
    console.warn(
      '[BookmarkList] handleRemoveFromCollection called without collectionId',
    )
  }
}
</script>

<template>
  <div class="h-full flex flex-col gap-2">
    <!-- Header -->
    <div>
      <div class="relative flex items-center gap-2">
        <div class="relative flex-1">
          <SearchIcon
            class="absolute left-2.5 top-3 size-4 text-muted-foreground"
          />
          <Input
            v-model="searchQuery"
            class="w-full pl-8"
            :placeholder="t('library.search.bookmarks')"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" class="h-10 w-10">
              <ArrowUpDownIcon class="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              :class="{ 'font-medium': sortBy === 'name' }"
              @click="setSortBy('name')"
            >
              {{ t('general.name') }}
              {{ sortBy === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :class="{ 'font-medium': sortBy === 'updatedAt' }"
              @click="setSortBy('updatedAt')"
            >
              {{ t('general.lastModified') }}
              {{
                sortBy === 'updatedAt' ? (sortOrder === 'asc' ? '↑' : '↓') : ''
              }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :class="{ 'font-medium': sortBy === 'createdAt' }"
              @click="setSortBy('createdAt')"
            >
              {{ t('general.dateAdded') }}
              {{
                sortBy === 'createdAt' ? (sortOrder === 'asc' ? '↑' : '↓') : ''
              }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <Spinner />
    </div>

    <!-- Empty State -->
    <div
      v-else-if="filteredBookmarks.length === 0"
      class="flex-1 flex items-center justify-center"
    >
      <div class="text-center">
        <p class="text-muted-foreground mb-2">
          {{
            searchQuery
              ? t('library.empty.searchResults', {
                  entityPlural: t('library.entities.bookmarks.title.plural'),
                })
              : t('library.empty.collectionBookmarks')
          }}
        </p>
        <Button v-if="searchQuery" @click="searchQuery = ''">
          {{ t('general.clearSearch') }}
        </Button>
      </div>
    </div>

    <!-- Places List -->
    <div v-else class="flex flex-col gap-2 pb-4 flex-1 overflow-y-auto touch-pan-y">
      <BookmarkCard
        v-for="bookmark in filteredBookmarks"
        :key="bookmark.id"
        :bookmark="bookmark"
        :collection-id="collectionId"
        @add-to-collection="handleAddToCollection"
        @remove-from-collection="handleRemoveFromCollection"
        class="w-full"
      />
    </div>
  </div>
</template>
