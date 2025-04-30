<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ItemIcon } from '@/components/ui/item-icon'
import {
  MoreVerticalIcon,
  FolderXIcon,
  PencilIcon,
  FolderPlusIcon,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { storeToRefs } from 'pinia'
import type { Bookmark } from '@/types/library.types'
import { getThemeColorClasses, type ThemeColor } from '@/lib/utils'
import { toast } from 'vue-sonner'
import { useAppService } from '@/services/app.service'
import BookmarkForm from '@/components/library/BookmarkForm.vue'
import CollectionPicker from '@/components/library/CollectionPicker.vue'

const props = defineProps<{
  place: Bookmark
  collectionId?: string
}>()

const emit = defineEmits<{
  edit: [place: Bookmark]
  unsave: [place: Bookmark]
  addToCollection: [place: Bookmark]
  removeFromCollection: [place: Bookmark]
}>()

const router = useRouter()
const collectionsStore = useCollectionsStore()
const bookmarksStore = useBookmarksStore()
const { collections } = storeToRefs(collectionsStore)
const collectionsService = useCollectionsService()
const appService = useAppService()
const { t } = useI18n()

onMounted(async () => {
  if (collections.value.length === 0) {
    await collectionsService.fetchCollections()
  }
})

const colorClasses = computed(() => {
  return getThemeColorClasses(props.place.iconColor as ThemeColor)
})

function goToPlace() {
  const route = bookmarksStore.navigateToPlace(props.place)
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

async function removeFromCollection() {
  try {
    await collectionsService.removeFromCollection(
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

function handleCollectionToggle(collectionId: string) {
  emit('addToCollection', props.place)
}

function handleCreateCollection(place: Bookmark) {
  console.log('Create new collection with:', place)
}

async function editPlace() {
  appService
    .componentDialog({
      component: BookmarkForm,
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

      if (props.collectionId) {
        await collectionsService.updateBookmarkInCollection(
          props.place.id,
          props.collectionId,
          params,
        )
      } else {
        const defaultCollection =
          await collectionsService.fetchDefaultCollection()
        if (defaultCollection) {
          await collectionsService.updateBookmarkInCollection(
            props.place.id,
            defaultCollection.id,
            params,
          )
        }
      }
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

              <!-- Add to collections submenu -->
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderPlusIcon class="size-4 mr-2" />
                  {{ t('library.actions.addToCollection') }}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent class="min-w-[240px]">
                  <CollectionPicker
                    :place="place"
                    :collection-id="collectionId"
                    @toggle-collection="handleCollectionToggle"
                    @create-collection="handleCreateCollection"
                  />
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
