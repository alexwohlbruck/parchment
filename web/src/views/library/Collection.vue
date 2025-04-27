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
  FileIcon,
} from 'lucide-vue-next'
import * as LucideIcons from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCollectionsService } from '@/services/library/collections.service'
import { getThemeColorClasses, type ThemeColor } from '@/lib/utils'
import type {
  Collection as CollectionType,
  SavedPlace,
} from '@/types/library.types'
import PlacesList from '@/components/library/PlacesList.vue'
import CollectionDialog from '@/components/library/CollectionDialog.vue'
import { ItemIcon } from '@/components/ui/item-icon'

const route = useRoute()
const router = useRouter()
const collectionsService = useCollectionsService()
const { t } = useI18n()

const id = route.params.id as string
const loading = ref(true)
const collection = ref<CollectionType | null>(null)
const places = ref<SavedPlace[]>([])
const showEditDialog = ref(false)

const collectionIcon = computed(() => {
  if (!collection.value) return FolderIcon

  // Add "Icon" suffix if not already present
  const iconName = collection.value.icon.endsWith('Icon')
    ? collection.value.icon
    : `${collection.value.icon}Icon`

  return LucideIcons[iconName as keyof typeof LucideIcons] || FolderIcon
})

const colorClasses = computed(() => {
  if (!collection.value) return ''
  return getThemeColorClasses(collection.value.iconColor as ThemeColor)
})

onMounted(async () => {
  loading.value = true

  collection.value = await collectionsService.fetchCollectionById(id)

  if (!collection.value) {
    router.push({ name: AppRoute.LIBRARY_COLLECTIONS })
    return
  }

  places.value = (collection.value as any).places || []
  loading.value = false
})

function goBack() {
  router.push({ name: AppRoute.LIBRARY_COLLECTIONS })
}

function editCollection() {
  if (!collection.value) return
  showEditDialog.value = true
}

function deleteCollection() {
  if (!collection.value) return

  if (confirm(t('library.confirmDelete', { name: collection.value.name }))) {
    collectionsService.deleteCollection(id).then(() => {
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
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="icon" @click="goBack">
            <ArrowLeftIcon class="size-4" />
          </Button>

          <div class="flex items-center gap-3">
            <ItemIcon
              :icon="collection.icon"
              :color="collection.iconColor as ThemeColor"
              size="md"
            />
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
      <PlacesList :places="places" :loading="loading" :collection-id="id" />

      <!-- Edit Collection Dialog -->
      <CollectionDialog
        v-if="showEditDialog"
        :collection="collection"
        @update:open="showEditDialog = $event"
      />
    </template>
  </div>
</template>
