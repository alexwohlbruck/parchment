<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { AppRoute } from '@/router'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeftIcon,
  FolderIcon,
  PencilIcon,
  TrashIcon,
  MoreVerticalIcon,
} from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLibraryService } from '@/services/library.service'
import {
  getIconFromString,
  getThemeColorClasses,
  type ThemeColor,
} from '@/lib/utils'
import type {
  Collection as CollectionType,
  SavedPlace,
} from '@/types/library.types'
import PlacesList from '@/components/library/PlacesList.vue'
import { toast } from 'vue-sonner'

const route = useRoute()
const router = useRouter()
const libraryService = useLibraryService()
const { t } = useI18n()

const id = route.params.id as string
const loading = ref(true)
const placesLoading = ref(true)
const collection = ref<CollectionType | null>(null)
const places = ref<SavedPlace[]>([])

const collectionIcon = computed(() => {
  if (!collection.value) return FolderIcon
  return getIconFromString(collection.value.icon)
})

const colorClasses = computed(() => {
  if (!collection.value) return ''
  return getThemeColorClasses(collection.value.iconColor as ThemeColor)
})

onMounted(async () => {
  loading.value = true

  collection.value = await libraryService.fetchCollectionById(id)

  if (!collection.value) {
    router.push('/library')
    return
  }

  try {
    placesLoading.value = true
    places.value = await libraryService.fetchPlacesInCollection(id)
    placesLoading.value = false
  } catch (error) {
    toast.error('Failed to load places in this collection')
  }

  loading.value = false
})

function goBack() {
  router.push({ name: AppRoute.LIBRARY_COLLECTIONS })
}

function editCollection() {
  if (!collection.value) return
  // TODO: Open edit dialog
  console.log('Edit collection:', collection.value)
}

function deleteCollection() {
  if (!collection.value) return

  if (confirm(t('library.confirmDelete', { name: collection.value.name }))) {
    libraryService.deleteCollection(id).then(() => {
      router.push({ name: AppRoute.LIBRARY_COLLECTIONS })
    })
  }
}
</script>

<template>
  <div class="h-full flex flex-col p-4 gap-4">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="text-muted-foreground">
        {{ t('library.loading.collection') }}
      </div>
    </div>

    <template v-else-if="collection">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Button variant="ghost" size="icon" @click="goBack">
            <ArrowLeftIcon class="size-4" />
          </Button>

          <div class="flex items-center gap-3">
            <div
              class="size-10 rounded-md flex items-center justify-center flex-shrink-0"
              :class="colorClasses"
            >
              <component :is="collectionIcon" class="size-5" />
            </div>

            <div>
              <h1 class="text-xl font-semibold">{{ collection.name }}</h1>
              <p
                v-if="collection.description"
                class="text-sm text-muted-foreground"
              >
                {{ collection.description }}
              </p>
            </div>
          </div>
        </div>

        <!-- Actions dropdown menu -->
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" class="h-9 w-9">
              <MoreVerticalIcon class="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="editCollection">
              <PencilIcon class="size-4 mr-2" />
              {{ t('general.edit') }}
            </DropdownMenuItem>
            <DropdownMenuItem
              @click="deleteCollection"
              class="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <TrashIcon class="size-4 mr-2" />
              {{ t('general.delete') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <!-- Places List -->
      <PlacesList
        :places="places"
        :loading="placesLoading"
        :collection-id="id"
      />
    </template>
  </div>
</template>
