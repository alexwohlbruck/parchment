<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import CollectionForm from '@/components/library/CollectionForm.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { useAppService } from '@/services/app.service'
import type { Collection, CreateCollectionParams } from '@/types/library.types'

const props = defineProps<{
  collection?: Collection
}>()

const { t } = useI18n()
const appService = useAppService()
const collectionsService = useCollectionsService()

function openCollectionDialog(collection?: Collection) {
  appService
    .componentDialog({
      component: CollectionForm,
      title: collection
        ? t('library.dialog.editCollection.title')
        : t('library.dialog.createCollection.title'),
      description: collection
        ? t('library.dialog.editCollection.description')
        : t('library.dialog.createCollection.description'),
      continueText: collection ? t('general.save') : t('general.create'),
      cancelText: t('general.cancel'),
      props: {
        collection,
      },
    })
    .then(async formData => {
      console.log('Form data received in dialog:', formData)
      if (!formData) return

      try {
        // Create the params object with correct structure
        const params: CreateCollectionParams = {
          name: formData.name,
          ...(formData.description
            ? { description: formData.description }
            : {}),
          icon: formData.icon,
          iconColor: formData.iconColor,
          isPublic: formData.isPublic,
        }

        console.log('Sending to API:', params)

        if (collection) {
          // Update existing collection
          await collectionsService.updateCollection(collection.id, params)
        } else {
          // Create new collection
          await collectionsService.createCollection(params)
        }
      } catch (error) {
        console.error('Error saving collection:', error)
      }
    })
}

// Auto-open the dialog when the component is mounted
onMounted(() => {
  openCollectionDialog(props.collection)
})
</script>

<template></template>
