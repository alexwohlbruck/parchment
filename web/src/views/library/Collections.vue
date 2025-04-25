<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import {
  PlusIcon,
  SearchIcon,
  ArrowUpDownIcon,
  FolderIcon,
} from 'lucide-vue-next'
import CollectionCard from '@/components/library/CollectionCard.vue'
import EmptyState from '@/components/library/EmptyState.vue'
import { useLibraryService } from '@/services/library.service'
import { useLibraryStore } from '@/stores/library.store'
import { storeToRefs } from 'pinia'
import { fuzzyFilter } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const libraryService = useLibraryService()
const libraryStore = useLibraryStore()
const { collections } = storeToRefs(libraryStore)
const loading = ref(true)
const searchQuery = ref('')

const sortBy = ref<'name' | 'createdAt'>('createdAt')
const sortOrder = ref<'asc' | 'desc'>('desc')

const filteredCollections = computed(() => {
  let result = searchQuery.value
    ? fuzzyFilter(collections.value, searchQuery.value, {
        keys: ['name', 'description'],
        preserveOrder: true, // Preserve original order, only apply sorting afterward
      })
    : collections.value

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

onMounted(async () => {
  loading.value = true
  await libraryService.fetchCollections()
  loading.value = false
})

function createCollection() {
  // TODO: Implement
  console.log('createCollection')
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
            placeholder="Search collections..."
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
              Name
              {{ sortBy === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : '' }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :class="{ 'font-medium': sortBy === 'createdAt' }"
              @click="setSortBy('createdAt')"
            >
              Date Added
              {{
                sortBy === 'createdAt' ? (sortOrder === 'asc' ? '↑' : '↓') : ''
              }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          disabled
          variant="outline"
          size="icon"
          class="h-10 w-10"
          @click="createCollection"
        >
          <PlusIcon class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Collections List -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="text-muted-foreground">Loading collections...</div>
    </div>

    <div
      v-else-if="filteredCollections.length === 0"
      class="flex-1 flex items-center justify-center"
    >
      <EmptyState
        v-if="!searchQuery"
        :icon="FolderIcon"
        entity-id="collections"
      />
      <div v-else class="text-center">
        <p class="text-muted-foreground mb-2">
          No collections match your search
        </p>
        <Button @click="searchQuery = ''">Clear Search</Button>
      </div>
    </div>

    <div v-else class="flex flex-col gap-2 pb-4">
      <CollectionCard
        v-for="collection in filteredCollections"
        :key="collection.id"
        :collection="collection"
        class="w-full"
      />
    </div>
  </div>
</template>
