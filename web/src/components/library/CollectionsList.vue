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
import { SearchIcon, ArrowUpDownIcon, PlusIcon } from 'lucide-vue-next'
import CollectionCard from '@/components/library/CollectionCard.vue'
import CollectionDialog from '@/components/library/CollectionDialog.vue'
import { fuzzyFilter } from '@/lib/utils'
import type { Collection } from '@/types/library.types'

const props = defineProps<{
  collections: Collection[]
  loading?: boolean
}>()

const { t } = useI18n()
const localCollections = ref<Collection[]>([...props.collections])

const searchQuery = ref('')
const sortBy = ref<'name' | 'createdAt'>('createdAt')
const sortOrder = ref<'asc' | 'desc'>('desc')
const showCreateDialog = ref(false)

watch(
  () => props.collections,
  newCollections => {
    localCollections.value = [...newCollections]
  },
  { deep: true },
)

const filteredCollections = computed(() => {
  let result = searchQuery.value
    ? fuzzyFilter(localCollections.value, searchQuery.value, {
        keys: ['name', 'description'],
        preserveOrder: true,
      })
    : localCollections.value

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

function createCollection() {
  showCreateDialog.value = true
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
            :placeholder="t('library.search.collections')"
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

        <Button
          variant="outline"
          size="icon"
          class="h-10 w-10"
          @click="createCollection"
        >
          <PlusIcon class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <Spinner />
    </div>

    <!-- Empty State -->
    <div
      v-else-if="filteredCollections.length === 0"
      class="flex-1 flex items-center justify-center"
    >
      <div class="text-center">
        <p class="text-muted-foreground mb-2">
          {{
            searchQuery
              ? t('library.empty.searchResults', {
                  entityPlural: t('library.entities.collections.title.plural'),
                })
              : t('library.empty.noCollectionsFound')
          }}
        </p>
        <Button v-if="searchQuery" @click="searchQuery = ''">
          {{ t('general.clearSearch') }}
        </Button>
      </div>
    </div>

    <!-- Collections List -->
    <div v-else class="flex flex-col gap-2 pb-4 flex-1 overflow-y-auto">
      <CollectionCard
        v-for="collection in filteredCollections"
        :key="collection.id"
        :collection="collection"
        class="w-full"
      />
    </div>

    <!-- Create Collection Dialog -->
    <CollectionDialog
      v-if="showCreateDialog"
      @update:open="showCreateDialog = $event"
    />
  </div>
</template>
