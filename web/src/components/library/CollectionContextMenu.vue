<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { MoreVerticalIcon, Pencil, Trash, StarIcon } from 'lucide-vue-next'
import { useCollectionsService } from '@/services/library/collections.service'
import { useAppService } from '@/services/app.service'
import CollectionForm from '@/components/library/CollectionForm.vue'
import type { Collection } from '@/types/library.types'
import type { ThemeColor } from '@/lib/utils'

const props = defineProps<{
  collection: Collection
  onDeleteSuccess?: () => void
}>()

const emit = defineEmits<{
  (e: 'edit'): void
}>()

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
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child @click.stop>
      <Button variant="ghost" size="icon" class="size-8">
        <MoreVerticalIcon class="size-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem @click.stop="editCollection">
        <Pencil class="size-4 mr-2" />
        {{ t('general.edit') }}
      </DropdownMenuItem>
      <DropdownMenuItem disabled>
        <StarIcon class="size-4 mr-2" />
        {{ t('library.actions.makeDefault') }}
      </DropdownMenuItem>
      <DropdownMenuItem @click.stop="deleteCollection" class="text-destructive">
        <Trash class="size-4 mr-2" />
        {{ t('general.delete') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
