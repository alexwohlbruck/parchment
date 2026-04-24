<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  MoreVerticalIcon,
  Pencil,
  Trash,
  StarIcon,
  Share2Icon,
} from 'lucide-vue-next'
import { useCollectionsService } from '@/services/library/collections.service'
import { useAppService } from '@/services/app.service'
import CollectionForm from '@/components/library/CollectionForm.vue'
import ShareDialog from '@/components/sharing/ShareDialog.vue'
import ResponsiveDropdown, {
  type MenuItemDefinition,
} from '@/components/responsive/ResponsiveDropdown.vue'
import type { Collection } from '@/types/library.types'
import type { ThemeColor } from '@/lib/utils'

const props = defineProps<{
  collection: Collection
  onDeleteSuccess?: () => void
}>()

const emit = defineEmits<{
  (e: 'edit'): void
}>()

// Share dialog lives alongside the menu so closing the menu doesn't
// tear down the dialog state. `isShareOpen` toggles independently.
const isShareOpen = ref(false)

const { t } = useI18n()
const collectionsService = useCollectionsService()
const appService = useAppService()

function editCollection() {
  appService
    .componentDialog({
      component: CollectionForm,
      title: t('library.dialog.editCollection.title'),
      description: t('library.dialog.editCollection.description'),
      continueText: t('general.save'),
      cancelText: t('general.cancel'),
      props: {
        collection: props.collection,
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
          iconColor: formData.iconColor as ThemeColor,
          isPublic: formData.isPublic,
        }

        // Update existing collection
        await collectionsService.updateCollection(props.collection.id, params)
        emit('edit')
      } catch (error) {
        console.error('Error updating collection:', error)
      }
    })
}

async function deleteCollection() {
  const confirmed = await appService.confirm({
    title: t('library.dialog.deleteCollection.title'),
    description: t('library.dialog.deleteCollection.description', {
      name: collectionsService.getCollectionDisplayName(props.collection),
    }),
    continueText: t('general.delete'),
    cancelText: t('general.cancel'),
    destructive: true,
  })

  if (confirmed) {
    await collectionsService.deleteCollection(props.collection.id)
  }
}

const menuItems = computed<MenuItemDefinition[]>(() => {
  const items: MenuItemDefinition[] = [
    {
      type: 'item',
      id: 'edit',
      label: t('general.edit'),
      icon: markRaw(Pencil),
      onSelect: editCollection,
    },
    {
      type: 'item',
      id: 'share',
      label: t('general.share'),
      icon: markRaw(Share2Icon),
      onSelect: () => {
        isShareOpen.value = true
      },
    },
  ]

  // Only show "make default" if collection is not already default
  if (!props.collection.isDefault) {
    items.push({
      type: 'item',
      id: 'make-default',
      label: t('library.actions.makeDefault'),
      icon: markRaw(StarIcon),
      disabled: true,
    })
  }

  // Only show delete if collection is not the default collection
  if (!props.collection.isDefault) {
    items.push({
      type: 'item',
      id: 'delete',
      label: t('general.delete'),
      icon: markRaw(Trash),
      variant: 'destructive',
      onSelect: deleteCollection,
    })
  }

  return items
})
</script>

<template>
  <ResponsiveDropdown
    align="end"
    :items="menuItems"
    :custom-snap-points="['300px', 0.5]"
  >
    <template #trigger="{ open }">
      <Button variant="ghost" size="icon" class="size-8" @click.stop="open">
        <MoreVerticalIcon class="size-4" />
      </Button>
    </template>
  </ResponsiveDropdown>

  <ShareDialog
    v-model:open="isShareOpen"
    :collection="collection"
  />
</template>
