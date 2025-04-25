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
import {
  LucideIcon,
  MoreVerticalIcon,
  Pencil,
  Trash,
  FolderPlusIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-vue-next'
import * as LucideIcons from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useLibraryStore } from '@/stores/library.store'
import { useLibraryService } from '@/services/library.service'
import { storeToRefs } from 'pinia'
import type { SavedPlace, Collection } from '@/types/library.types'
import type { UnifiedPlace } from '@/types/unified-place.types'
import {
  getIconFromString,
  getThemeColorClasses,
  fuzzyFilter,
  type ThemeColor,
} from '@/lib/utils'
import { toast } from 'vue-sonner'

const props = defineProps<{
  place: SavedPlace
}>()

const emit = defineEmits<{
  edit: [place: SavedPlace]
  unsave: [place: SavedPlace]
  addToCollection: [place: SavedPlace]
}>()

const router = useRouter()
const libraryStore = useLibraryStore()
const { collections } = storeToRefs(libraryStore)
const libraryService = useLibraryService()
const { t } = useI18n()
const collectionSearchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const isAddingToCollection = ref(false)

onMounted(async () => {
  if (collections.value.length === 0) {
    await libraryService.fetchCollections()
  }
})

const filteredCollections = computed(() => {
  return fuzzyFilter(collections.value, collectionSearchQuery.value, {
    keys: ['name', 'description'],
    preserveOrder: true,
  })
})

const placeIcon = computed(() => {
  return getIconFromString(props.place.icon)
})

const colorClasses = computed(() => {
  return getThemeColorClasses(props.place.iconColor as ThemeColor)
})

function goToPlace() {
  const route = libraryStore.navigateToPlace(props.place)
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
  try {
    await libraryService.unsavePlace(props.place.id, props.place)
    emit('unsave', props.place)
  } catch (error) {
    console.error('Failed to unsave place:', error)
  }
}

async function addToCollection(collectionId: string) {
  try {
    isAddingToCollection.value = true
    await libraryService.addPlaceToCollection(props.place.id, collectionId)
    toast.success(`Added to collection`)
  } catch (error) {
    console.error('Failed to add place to collection:', error)
    toast.error('Failed to add to collection')
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
</script>

<template>
  <Card
    class="overflow-hidden hover:bg-secondary/40 transition-colors cursor-pointer"
    @click="goToPlace"
  >
    <CardContent class="p-2 flex items-center gap-3">
      <!-- Icon -->
      <div
        class="size-10 rounded-md flex items-center justify-center flex-shrink-0"
        :class="colorClasses"
      >
        <component :is="placeIcon" class="size-5" />
      </div>

      <!-- Content -->
      <div class="flex-grow min-w-0">
        <div class="flex items-center justify-between">
          <div class="flex flex-col justify-center">
            <h3 class="font-semibold text-sm">{{ place.name }}</h3>

            <!-- Display address if available -->
            <div v-if="place.address" class="text-xs text-muted-foreground">
              {{ place.address }}
            </div>

            <!-- Display place type or preset type if available -->
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
              <!-- Add to Collection Sub-Menu -->
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderPlusIcon class="size-4 mr-2" />
                  {{ t('library.actions.addToCollection') }}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent class="min-w-[240px]">
                  <!-- Collection search input -->
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

                  <!-- List of collections -->
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
                        <component
                          :is="getIconFromString(collection.icon)"
                          class="size-4"
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

                  <!-- Create new collection option -->
                  <DropdownMenuItem @click.stop="createNewCollection" disabled>
                    <PlusIcon class="size-4" />
                    {{ t('library.actions.createNewCollection') }}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <!-- Unsave option -->
              <DropdownMenuItem
                @click.stop="unsavePlace"
                class="text-destructive hover:text-destructive focus:text-destructive focus:bg-destructive/10 hover:bg-destructive/10"
              >
                <Trash class="size-4" />
                {{ t('general.unsave') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
