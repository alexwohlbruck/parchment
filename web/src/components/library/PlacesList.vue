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
import { SearchIcon, ArrowUpDownIcon } from 'lucide-vue-next'
import SavedPlaceCard from '@/components/library/SavedPlaceCard.vue'
import { fuzzyFilter } from '@/lib/utils'
import type { SavedPlace } from '@/types/library.types'
import { useLibraryService } from '@/services/library.service'

const props = defineProps<{
  places: SavedPlace[]
  loading?: boolean
}>()

const { t } = useI18n()
const localPlaces = ref<SavedPlace[]>([...props.places])
const libraryService = useLibraryService()

const searchQuery = ref('')
const sortBy = ref<'name' | 'createdAt'>('createdAt')
const sortOrder = ref<'asc' | 'desc'>('desc')

watch(
  () => props.places,
  newPlaces => {
    localPlaces.value = [...newPlaces]
  },
  { deep: true },
)

const filteredPlaces = computed(() => {
  let result = searchQuery.value
    ? fuzzyFilter(localPlaces.value, searchQuery.value, {
        keys: ['name', 'presetType', 'address'],
        preserveOrder: true,
      })
    : localPlaces.value

  result = [...result].sort((a, b) => {
    let comparison = 0

    if (sortBy.value === 'name') {
      comparison = a.name.localeCompare(b.name)
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

function setSortBy(field: 'name' | 'createdAt') {
  if (sortBy.value === field) {
    toggleSortOrder()
  } else {
    sortBy.value = field
    sortOrder.value = field === 'name' ? 'asc' : 'desc'
  }
}

// Handle place unsaved (removing it from the local list)
function handlePlaceUnsaved(place: SavedPlace) {
  // No need to call the API here since the SavedPlaceCard already did it
  // Just update our local state to remove the place
  localPlaces.value = localPlaces.value.filter(p => p.id !== place.id)
}

// Handle adding a place to a collection (no UI change needed)
function handleAddToCollection(place: SavedPlace) {
  // No UI change needed as the operation doesn't affect the list
  // The SavedPlaceCard component handles the API call and toast
  console.log('Place added to collection:', place.name)
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
            :placeholder="t('library.search.places')"
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
      <div class="text-muted-foreground">{{ t('library.loading.places') }}</div>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="filteredPlaces.length === 0"
      class="flex-1 flex items-center justify-center"
    >
      <div class="text-center">
        <p class="text-muted-foreground mb-2">
          {{
            searchQuery
              ? t('library.empty.searchResults', {
                  entityPlural: t('library.entities.places.title.plural'),
                })
              : t('library.empty.collectionPlaces')
          }}
        </p>
        <Button v-if="searchQuery" @click="searchQuery = ''">
          {{ t('general.clearSearch') }}
        </Button>
      </div>
    </div>

    <!-- Places List -->
    <div v-else class="flex flex-col gap-2 pb-4">
      <SavedPlaceCard
        v-for="place in filteredPlaces"
        :key="place.id"
        :place="place"
        @unsave="handlePlaceUnsaved"
        @add-to-collection="handleAddToCollection"
        class="w-full"
      />
    </div>
  </div>
</template>
