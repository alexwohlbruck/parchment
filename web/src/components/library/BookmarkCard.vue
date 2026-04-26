<script setup lang="ts">
import { computed, onMounted, markRaw } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { ItemIcon } from '@/components/ui/item-icon'
import {
  MoreVerticalIcon,
  PencilIcon,
  FolderPlusIcon,
  FolderMinusIcon,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { storeToRefs } from 'pinia'
import type { Bookmark } from '@/types/library.types'
import type { ThemeColor } from '@/lib/utils'
import { useAppService } from '@/services/app.service'
import BookmarkForm from '@/components/library/BookmarkForm.vue'
import CollectionPicker from '@/components/library/CollectionPicker.vue'
import ResponsiveDropdown, {
  type MenuItemDefinition,
} from '@/components/responsive/ResponsiveDropdown.vue'

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

const menuItems = computed<MenuItemDefinition[]>(() => {
  const items: MenuItemDefinition[] = [
    {
      type: 'item',
      id: 'edit',
      label: t('general.edit'),
      icon: markRaw(PencilIcon),
      onSelect: editBookmark,
    },
    {
      type: 'submenu',
      id: 'add-to-collection',
      label: t('library.actions.addToCollection'),
      icon: markRaw(FolderPlusIcon),
      customComponent: markRaw(CollectionPicker),
      customProps: {
        bookmark: props.bookmark,
      },
    },
  ]

  // Only render the "Remove from this collection" action when the card is
  // rendered inside a specific collection AND the caller has write access
  // to it. Owner or editor can remove; viewers on shared collections
  // can't — the server would reject the call anyway, so hiding the item
  // prevents a confusing error toast.
  if (props.collectionId) {
    const collection = collectionsStore.getCollectionById(props.collectionId)
    const canWrite =
      collection && (!collection.role || collection.role === 'owner' || collection.role === 'editor')
    if (canWrite) {
      items.push({
        type: 'item',
        id: 'remove-from-collection',
        label: t('library.actions.removeFromCollection'),
        icon: markRaw(FolderMinusIcon),
        variant: 'destructive',
        onSelect: () => emit('removeFromCollection', props.bookmark),
      })
    }
  }

  return items
})
</script>

<template>
  <Card
    class="overflow-hidden hover:bg-secondary/40 transition-colors cursor-pointer"
    @click="navigateToBookmark"
  >
    <CardContent class="p-2 flex items-center gap-3">
      <ItemIcon
        :icon="bookmark.icon"
        :icon-pack="bookmark.iconPack ?? 'lucide'"
        :color="(bookmark.iconColor as ThemeColor) || 'blue'"
        size="md"
      />

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
          <ResponsiveDropdown
            align="end"
            :items="menuItems"
            :z-index-offset="1"
            :custom-snap-points="['400px', 0.7]"
          >
            <template #trigger="{ open }">
              <Button
                variant="ghost"
                size="icon"
                class="size-8"
                @click.stop="open"
              >
                <MoreVerticalIcon class="size-4" />
              </Button>
            </template>
          </ResponsiveDropdown>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
