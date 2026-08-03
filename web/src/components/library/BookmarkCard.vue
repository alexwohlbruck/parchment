<script setup lang="ts">
import { computed, onMounted, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { PlaceCard } from '@/components/place/card'
import {
  MoreVerticalIcon,
  PencilIcon,
  FolderPlusIcon,
  FolderMinusIcon,
} from 'lucide-vue-next'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { storeToRefs } from 'pinia'
import type { Bookmark } from '@/types/library.types'
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

const collectionsStore = useCollectionsStore()
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
        frequentType: formData.type || null,
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
  <!-- A frequent shows the look fixed by its type; everything else shows the
       bookmarked POI's own icon and colour. Neither is user-chosen. -->
  <PlaceCard :bookmark="bookmark" variant="row" size="md">
    <template #trailing>
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
            class="size-8 shrink-0"
            @click.stop.prevent="open"
          >
            <MoreVerticalIcon class="size-4" />
          </Button>
        </template>
      </ResponsiveDropdown>
    </template>
  </PlaceCard>
</template>
