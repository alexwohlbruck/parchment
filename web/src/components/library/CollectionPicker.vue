<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { ItemIcon } from '@/components/ui/item-icon'
import { SearchIcon, PlusIcon, CheckIcon, StarIcon } from 'lucide-vue-next'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useCollectionsService } from '@/services/library/collections.service'
import { useAppService } from '@/services/app.service'
import CollectionForm from '@/components/library/CollectionForm.vue'
import { storeToRefs } from 'pinia'
import type { Bookmark, CreateCollectionParams } from '@/types/library.types'
import { getThemeColorClasses, fuzzyFilter, type ThemeColor } from '@/lib/utils'
import { api } from '@/lib/api'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

const props = defineProps<{
  place: Bookmark
  collectionId?: string
}>()

const collectionsStore = useCollectionsStore()
const collectionsService = useCollectionsService()
const { collections } = storeToRefs(collectionsStore)
const { t } = useI18n()
const appService = useAppService()
const collectionSearchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const isAddingToCollection = ref(false)
const placeCollections = ref<string[]>([])

onMounted(async () => {
  if (collections.value.length === 0) {
    await collectionsService.fetchCollections()
  }
  await fetchCollectionsForPlace()
})

async function fetchCollectionsForPlace() {
  const response = await api.get(
    `/library/places/${props.place.id}/collections`,
  )
  placeCollections.value = response.data.map((collection: any) => collection.id)
}

const filteredCollections = computed(() => {
  let filtered = fuzzyFilter(collections.value, collectionSearchQuery.value, {
    keys: ['name', 'description'],
    preserveOrder: true,
  })

  return filtered
})

const sortedAndFilteredCollections = computed(() => {
  let filtered = filteredCollections.value

  const defaultCollectionIndex = filtered.findIndex(c => c.isDefault)
  let defaultCollection: (typeof filtered)[number] | null = null
  if (defaultCollectionIndex !== -1) {
    defaultCollection = filtered.splice(defaultCollectionIndex, 1)[0]
  }

  filtered.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )

  if (defaultCollection) {
    filtered.unshift(defaultCollection)
  }

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
      await collectionsService.removeFromCollection(
        props.place.id,
        collectionId,
      )
      placeCollections.value = placeCollections.value.filter(
        id => id !== collectionId,
      )
    } else {
      await collectionsService.saveToCollection(props.place.id, collectionId)
      placeCollections.value.push(collectionId)
    }
  } finally {
    isAddingToCollection.value = false
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

      const params: CreateCollectionParams = {
        name: formData.name,
        ...(formData.description ? { description: formData.description } : {}),
        icon: formData.icon,
        iconColor: formData.iconColor,
        isPublic: formData.isPublic,
      }
      const newCollection = await collectionsService.createCollection(params)

      if (newCollection && newCollection.id) {
        await toggleCollection(newCollection.id)
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
    <DropdownMenuSeparator />

    <div v-if="sortedAndFilteredCollections.length > 0">
      <template
        v-for="(collection, index) in sortedAndFilteredCollections"
        :key="collection.id"
      >
        <DropdownMenuItem
          :disabled="isAddingToCollection"
          @click.prevent.stop="toggleCollection(collection.id)"
        >
          <!-- Icon container with optional star badge -->
          <div class="relative mr-2">
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

          <span class="flex-grow min-w-0">
            {{ getCollectionDisplayName(collection) }}
          </span>
          <CheckIcon
            v-if="placeCollections.includes(collection.id)"
            class="size-4 text-primary ml-auto"
          />
        </DropdownMenuItem>
        <!-- Add separator after the first item (pinned default) if it exists and there are more items -->
        <DropdownMenuSeparator
          v-if="
            index === 0 &&
            collection.isDefault &&
            sortedAndFilteredCollections.length > 1
          "
        />
      </template>
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

    <DropdownMenuItem @click.prevent.stop="openCreateCollectionDialog">
      <PlusIcon class="size-4 mr-2" />
      {{ t('library.actions.createNewCollection') }}
    </DropdownMenuItem>
  </div>
</template>
