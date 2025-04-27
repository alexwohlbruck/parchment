<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ItemIcon } from '@/components/ui/item-icon'
import {
  MoreVerticalIcon,
  FolderPlusIcon,
  PlusIcon,
  SearchIcon,
  FolderXIcon,
  BookmarkXIcon,
  PencilIcon,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useSavedPlacesStore } from '@/stores/library/savedPlaces.store'
import { useCollectionsService } from '@/services/library/collections.service'
import { useSavedPlacesService } from '@/services/library/saved-places.service'
import { storeToRefs } from 'pinia'
import type { SavedPlace } from '@/types/library.types'
import { getThemeColorClasses, fuzzyFilter, type ThemeColor } from '@/lib/utils'
import { toast } from 'vue-sonner'
import { useAppService } from '@/services/app.service'
import SavedPlaceForm from '@/components/library/SavedPlaceForm.vue'

const props = defineProps<{
  place: SavedPlace
  collectionId?: string
}>()

const emit = defineEmits<{
  edit: [place: SavedPlace]
  unsave: [place: SavedPlace]
  addToCollection: [place: SavedPlace]
  removeFromCollection: [place: SavedPlace]
}>()

const router = useRouter()
const collectionsStore = useCollectionsStore()
const savedPlacesStore = useSavedPlacesStore()
const { collections } = storeToRefs(collectionsStore)
const collectionsService = useCollectionsService()
const savedPlacesService = useSavedPlacesService()
const appService = useAppService()
const { t } = useI18n()
const collectionSearchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const isAddingToCollection = ref(false)

onMounted(async () => {
  if (collections.value.length === 0) {
    await collectionsService.fetchCollections()
  }
})

const filteredCollections = computed(() => {
  let filtered = fuzzyFilter(collections.value, collectionSearchQuery.value, {
    keys: ['name', 'description'],
    preserveOrder: true,
  })

  // Filter out the current collection if we're in a collection context
  if (props.collectionId) {
    filtered = filtered.filter(c => c.id !== props.collectionId)
  }

  return filtered
})

const colorClasses = computed(() => {
  return getThemeColorClasses(props.place.iconColor as ThemeColor)
})

function goToPlace() {
  const route = savedPlacesStore.navigateToPlace(props.place)
  const [type, osmId] = props.place.externalIds.osm.split('/')
  console.log(type, osmId)
  if (route) {
    router.push({
      name: 'place',
      params: {
        id: osmId,
        type,
      },
    })
  }
}

async function unsavePlace() {
  await savedPlacesService.unsavePlace(props.place.id, props.place.name)
}

async function addToCollection(collectionId: string) {
  try {
    isAddingToCollection.value = true
    await collectionsService.addPlaceToCollection(props.place.id, collectionId)
  } finally {
    isAddingToCollection.value = false
  }
}

function createNewCollection() {
  console.log('Create new collection with:', props.place)
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

async function removeFromCollection() {
  try {
    await collectionsService.removePlaceFromCollection(
      props.place.id,
      props.collectionId!,
    )
    toast.success(t('library.actions.removedFromCollection'))
    emit('removeFromCollection', props.place)
  } catch (error) {
    console.error('Failed to remove place from collection:', error)
    toast.error(t('library.actions.failedToRemoveFromCollection'))
  }
}

async function editPlace() {
  appService
    .componentDialog({
      component: SavedPlaceForm,
      title: t('library.dialog.editPlace.title'),
      description: t('library.dialog.editPlace.description'),
      continueText: t('general.save'),
      cancelText: t('general.cancel'),
      props: {
        place: props.place,
      },
    })
    .then(async formData => {
      if (!formData) return

      const params = {
        name: formData.name,
        ...(formData.type ? { presetType: formData.type } : {}),
        icon: formData.icon,
        iconColor: formData.iconColor as ThemeColor,
      }

      await savedPlacesService.updatePlace(props.place.id, params)
    })
}
</script>

<template>
  <Card
    class="overflow-hidden hover:bg-secondary/40 transition-colors cursor-pointer"
    @click="goToPlace"
  >
    <CardContent class="p-2 flex items-center gap-3">
      <div
        class="size-10 rounded-md flex items-center justify-center flex-shrink-0"
        :class="colorClasses"
      >
        <ItemIcon
          :icon="place.icon"
          :color="place.iconColor as ThemeColor"
          size="md"
        />
      </div>

      <div class="flex-grow min-w-0">
        <div class="flex items-center justify-between">
          <div class="flex flex-col justify-center">
            <h3 class="font-semibold text-sm">{{ place.name }}</h3>

            <div v-if="place.address" class="text-xs text-muted-foreground">
              {{ place.address }}
            </div>

            <div
              v-if="place.presetType"
              class="text-xs text-muted-foreground capitalize"
            >
              {{ place.presetType }}
            </div>
          </div>

          <!-- Actions dropdown -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child @click.stop>
              <Button variant="ghost" size="icon" class="size-8">
                <MoreVerticalIcon class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click.stop="editPlace">
                <PencilIcon class="size-4" />
                {{ t('general.edit') }}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderPlusIcon class="size-4 mr-2" />
                  {{ t('library.actions.addToCollection') }}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent class="min-w-[240px]">
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
                      @click.stop="addToCollection(collection.id)"
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
                      {{ collection.name }}
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
                        entityPlural: t(
                          'library.entities.collections.title.plural',
                        ),
                      })
                    }}
                  </div>

                  <DropdownMenuItem @click.stop="createNewCollection" disabled>
                    <PlusIcon class="size-4" />
                    {{ t('library.actions.createNewCollection') }}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuItem
                v-if="collectionId"
                @click.stop="removeFromCollection"
                class="text-destructive hover:text-destructive focus:text-destructive focus:bg-destructive/10 hover:bg-destructive/10"
              >
                <FolderXIcon class="size-4" />
                {{ t('library.actions.removeFromCollection') }}
              </DropdownMenuItem>

              <DropdownMenuItem
                @click.stop="unsavePlace"
                class="text-destructive hover:text-destructive focus:text-destructive focus:bg-destructive/10 hover:bg-destructive/10"
              >
                <BookmarkXIcon class="size-4" />
                {{ t('general.unsave') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
