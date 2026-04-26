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
import {
  SearchIcon,
  ArrowUpDownIcon,
  PlusIcon,
  FilterIcon,
  CheckIcon,
} from 'lucide-vue-next'
import CollectionCard from '@/components/library/CollectionCard.vue'
import CollectionForm from '@/components/library/CollectionForm.vue'
import { useAppService } from '@/services/app.service'
import { useCollectionsService } from '@/services/library/collections.service'
import { fuzzyFilter } from '@/lib/utils'
import type { Collection, CreateCollectionParams } from '@/types/library.types'

const props = defineProps<{
  collections: Collection[]
  loading?: boolean
}>()

const { t } = useI18n()
const localCollections = ref<Collection[]>([...props.collections])

const searchQuery = ref('')
const sortBy = ref<'name' | 'createdAt' | 'updatedAt'>('updatedAt')
const sortOrder = ref<'asc' | 'desc'>('desc')
// Ownership filter: 'all' shows both, 'mine' hides collections the caller
// was only invited to, 'shared' hides their own. Keys a computed below.
type OwnershipFilter = 'all' | 'mine' | 'shared'
const ownershipFilter = ref<OwnershipFilter>('all')
const appService = useAppService()
const collectionsService = useCollectionsService()

watch(
  () => props.collections,
  newCollections => {
    localCollections.value = [...newCollections]
  },
  { deep: true },
)

const sharedCount = computed(
  () => localCollections.value.filter((c) => c.role && c.role !== 'owner').length,
)

const filteredCollections = computed(() => {
  let result = searchQuery.value
    ? fuzzyFilter(localCollections.value, searchQuery.value, {
        keys: ['name', 'description'],
        preserveOrder: true,
      })
    : localCollections.value

  // Ownership filter runs after search so users can still find anything by
  // name even when "Shared with me" is active.
  if (ownershipFilter.value === 'mine') {
    result = result.filter((c) => !c.role || c.role === 'owner')
  } else if (ownershipFilter.value === 'shared') {
    result = result.filter((c) => c.role && c.role !== 'owner')
  }

  result = [...result].sort((a, b) => {
    let comparison = 0

    if (sortBy.value === 'name') {
      comparison = (a.name || '').localeCompare(b.name || '')
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

async function createCollection() {
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

      const params: CreateCollectionParams = {
        name: formData.name,
        ...(formData.description ? { description: formData.description } : {}),
        icon: formData.icon,
        iconColor: formData.iconColor,
        isPublic: formData.isPublic,
      }
      await collectionsService.createCollection(params)
    })
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

        <!-- Ownership filter: All / Mine / Shared with me. Hidden when the
             user has no shared collections yet so the UI stays clean. -->
        <DropdownMenu v-if="sharedCount > 0">
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              class="h-10 w-10"
              :class="{ 'ring-1 ring-primary': ownershipFilter !== 'all' }"
              :title="t('library.collections.filter.label')"
            >
              <FilterIcon class="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="ownershipFilter = 'all'">
              <CheckIcon
                v-if="ownershipFilter === 'all'"
                class="size-4 mr-2"
              />
              <span v-else class="inline-block size-4 mr-2" />
              {{ t('library.collections.filter.all') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="ownershipFilter = 'mine'">
              <CheckIcon
                v-if="ownershipFilter === 'mine'"
                class="size-4 mr-2"
              />
              <span v-else class="inline-block size-4 mr-2" />
              {{ t('library.collections.filter.mine') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="ownershipFilter = 'shared'">
              <CheckIcon
                v-if="ownershipFilter === 'shared'"
                class="size-4 mr-2"
              />
              <span v-else class="inline-block size-4 mr-2" />
              {{ t('library.collections.filter.shared') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <Spinner />
    </div>

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

    <div v-else class="flex flex-col gap-2 pb-4 flex-1">
      <CollectionCard
        v-for="collection in filteredCollections"
        :key="collection.id"
        :collection="collection"
        class="w-full"
      />
    </div>
  </div>
</template>
