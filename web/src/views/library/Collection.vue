<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { AppRoute } from '@/router'
import { useI18n } from 'vue-i18n'
import { useAppService } from '@/services/app.service'
import CollectionForm from '@/components/library/CollectionForm.vue'
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
  Bookmark,
} from '@/types/library.types'
import BookmarkList from '@/components/library/BookmarkList.vue'
import { ItemIcon } from '@/components/ui/item-icon'

const route = useRoute()
const router = useRouter()
const collectionsService = useCollectionsService()
const appService = useAppService()
const { t } = useI18n()

const id = route.params.id as string
const loading = ref(true)
const collection = ref<CollectionType | null>(null)
const places = ref<Bookmark[]>([])

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

const collectionName = computed(() => {
  if (!collection.value) return ''

  // If this is the default collection, use the i18n name
  if (collection.value.isDefault) {
    // If the collection has a custom name, use it, otherwise use the i18n name
    return collection.value.name || t('library.entities.collections.default')
  }

  return collection.value.name
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

  appService
    .componentDialog({
      component: CollectionForm,
      title: t('library.dialog.editCollection.title'),
      description: t('library.dialog.editCollection.description'),
      continueText: t('general.save'),
      cancelText: t('general.cancel'),
      props: {
        collection: collection.value,
      },
    })
    .then(async formData => {
      if (!formData) return

      try {
        // Create the params object with correct structure
        const params = {
          name: formData.name,
          ...(formData.description
            ? { description: formData.description }
            : {}),
          icon: formData.icon,
          iconColor: formData.iconColor,
          isPublic: formData.isPublic,
        }

        // Update existing collection
        await collectionsService.updateCollection(id, params)

        // Update local state
        if (collection.value) {
          collection.value.name = params.name
          if (params.description)
            collection.value.description = params.description
          collection.value.icon = params.icon
          collection.value.iconColor = params.iconColor
          collection.value.isPublic = params.isPublic
        }
      } catch (error) {
        console.error('Error updating collection:', error)
      }
    })
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
              <h1 class="text-xl font-semibold">{{ collectionName }}</h1>
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
      <BookmarkList :places="places" :loading="loading" :collection-id="id" />
    </template>
  </div>
</template>
