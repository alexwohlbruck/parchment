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
import { useAppService } from '@/services/app.service'
import BookmarkForm from '@/components/library/BookmarkForm.vue'
import CollectionPicker from '@/components/library/CollectionPicker.vue'
import ResponsiveDropdown from '@/components/responsive/ResponsiveDropdown.vue'

const props = defineProps<{
  bookmark: Bookmark
  collectionId?: string
}>()

const emit = defineEmits<{
  edit: [bookmark: Bookmark]
  unsave: [bookmark: Bookmark]
  addToCollection: [bookmark: Bookmark]
  removeFromCollection: [bookmark: Bookmark]
}>()

const router = useRouter()
const collectionsStore = useCollectionsStore()
const bookmarksStore = useBookmarksStore()
const { collections } = storeToRefs(collectionsStore)
const collectionsService = useCollectionsService()
const bookmarksService = useBookmarksService()
const appService = useAppService()
const { t } = useI18n()

onMounted(async () => {
  if (collections.value.length === 0) {
    await collectionsService.fetchCollections()
  }
})

const colorClasses = computed(() => {
  return getThemeColorClasses(props.bookmark.iconColor as ThemeColor)
})

function navigateToBookmark() {
  const route = bookmarksStore.navigateToBookmark(props.bookmark)
  const [type, osmId] = props.bookmark.externalIds.osm.split('/')
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

function handleCollectionToggle(collectionId: string) {
  emit('addToCollection', props.bookmark)
}

function handleCreateCollection(bookmark: Bookmark) {
  console.log('Create new collection with:', bookmark)
}

async function editBookmark() {
  appService
    .componentDialog({
      component: BookmarkForm,
      title: t('library.dialog.editBookmark.title'),
      description: t('library.dialog.editBookmark.description'),
      continueText: t('general.save'),
      cancelText: t('general.cancel'),
      props: {
        bookmark: props.bookmark,
      },
    })
    .then(async formData => {
      if (!formData) return

      const params = {
        name: formData.name,
        presetType: formData.type || null,
        icon: formData.icon,
        iconColor: formData.iconColor as ThemeColor,
      }

      await bookmarksService.updateBookmark(props.bookmark.id, params)
    })
}
</script>

<template>
  <Card
    class="overflow-hidden hover:bg-secondary/40 transition-colors cursor-pointer"
    @click="navigateToBookmark"
  >
    <CardContent class="p-2 flex items-center gap-3">
      <div
        class="size-10 rounded-md flex items-center justify-center shrink-0"
        :class="colorClasses"
      >
        <ItemIcon
          :icon="bookmark.icon"
          :color="bookmark.iconColor as ThemeColor"
          size="md"
        />
      </div>

      <div class="grow min-w-0">
        <div class="flex items-center justify-between">
          <div class="flex flex-col justify-center">
            <h3 class="font-semibold text-sm">{{ bookmark.name }}</h3>

            <div v-if="bookmark.address" class="text-xs text-muted-foreground">
              {{ bookmark.address }}
            </div>

            <div
              v-if="bookmark.presetType"
              class="text-xs text-muted-foreground capitalize"
            >
              {{ bookmark.presetType }}
            </div>
          </div>

          <!-- Actions dropdown -->
          <ResponsiveDropdown align="end" :custom-snap-points="['400px', 0.7]">
            <template #trigger>
              <Button variant="ghost" size="icon" class="size-8" @click.stop>
                <MoreVerticalIcon class="size-4" />
              </Button>
            </template>

            <template #content="{ close }">
              <DropdownMenuItem
                @click.stop="
                  editBookmark()
                  close()
                "
              >
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
                    :bookmark="bookmark"
                    @toggle-collection="handleCollectionToggle"
                    @create-collection="handleCreateCollection"
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </template>
          </ResponsiveDropdown>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
