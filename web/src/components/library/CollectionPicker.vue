<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { ItemIcon } from '@/components/ui/item-icon'
import { SearchIcon, PlusIcon, CheckIcon } from 'lucide-vue-next'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useCollectionsService } from '@/services/library/collections.service'
import { storeToRefs } from 'pinia'
import type { Bookmark } from '@/types/library.types'
import { getThemeColorClasses, fuzzyFilter, type ThemeColor } from '@/lib/utils'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

const props = defineProps<{
  place: Bookmark
  collectionId?: string
}>()

const emit = defineEmits(['toggle-collection', 'create-collection'])

const collectionsStore = useCollectionsStore()
const collectionsService = useCollectionsService()
const { collections } = storeToRefs(collectionsStore)
const { t } = useI18n()
const collectionSearchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const isAddingToCollection = ref(false)
const placeCollections = ref<string[]>([])

onMounted(async () => {
  if (collections.value.length === 0) {
    await collectionsService.fetchCollections()
  }

  // Fetch collections for this place
  await fetchCollectionsForPlace()
})

async function fetchCollectionsForPlace() {
  try {
    const response = await api.get(
      `/library/places/${props.place.id}/collections`,
    )
    placeCollections.value = response.data.map(
      (collection: any) => collection.id,
    )
  } catch (error) {
    console.error('Failed to fetch collections for place:', error)
  }
}

const filteredCollections = computed(() => {
  let filtered = fuzzyFilter(collections.value, collectionSearchQuery.value, {
    keys: ['name', 'description'],
    preserveOrder: true,
  })

  return filtered
})

function getCollectionDisplayName(collection: any) {
  if (collection.isDefault) {
    return collection.name || t('library.entities.collections.default')
  }

  return collection.name
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
  try {
    isAddingToCollection.value = true

    if (placeCollections.value.includes(collectionId)) {
      await collectionsService.removePlaceFromCollection(
        props.place.id,
        collectionId,
      )
      placeCollections.value = placeCollections.value.filter(
        id => id !== collectionId,
      )

      const collection = collections.value.find(c => c.id === collectionId)
      if (collection) {
        toast.success(t('library.actions.removedFromCollection'))
      }
    } else {
      // Add to collection
      await collectionsService.addPlaceToCollection(
        props.place.id,
        collectionId,
      )
      placeCollections.value.push(collectionId)

      const collection = collections.value.find(c => c.id === collectionId)
      if (collection) {
        toast.success(
          t('library.actions.addedToCollection', {
            collection: getCollectionDisplayName(collection),
          }),
        )
      }
    }

    emit('toggle-collection', collectionId)
  } finally {
    isAddingToCollection.value = false
  }
}

function createNewCollection() {
  emit('create-collection', props.place)
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
    <DropdownMenuSeparator />

    <div v-if="filteredCollections.length > 0">
      <DropdownMenuItem
        v-for="collection in filteredCollections"
        :key="collection.id"
        :disabled="isAddingToCollection"
        @click.stop="toggleCollection(collection.id)"
      >
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
        <span class="flex-grow">
          {{ getCollectionDisplayName(collection) }}
        </span>
        <CheckIcon
          v-if="placeCollections.includes(collection.id)"
          class="size-4 text-primary"
        />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
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

    <DropdownMenuItem @click.stop="createNewCollection" disabled>
      <PlusIcon class="size-4 mr-2" />
      {{ t('library.actions.createNewCollection') }}
    </DropdownMenuItem>
  </div>
</template>
