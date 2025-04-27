<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ComponentDialog from '@/components/dialogs/ComponentDialog.vue'
import CollectionForm from '@/components/library/CollectionForm.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import type { Collection, CreateCollectionParams } from '@/types/library.types'

const props = defineProps<{
  collection?: Collection
}>()

const { t } = useI18n()
const collectionsService = useCollectionsService()

const isOpen = ref(true)
const isSubmitting = ref(false)

function getDialogTitle() {
  return props.collection
    ? t('library.dialog.editCollection.title')
    : t('library.dialog.createCollection.title')
}

function getDialogDescription() {
  return props.collection
    ? t('library.dialog.editCollection.description')
    : t('library.dialog.createCollection.description')
}

// When the form is submitted in the component dialog
async function handleSubmit(formRef: any) {
  try {
    isSubmitting.value = true

    // Get form data from the component
    const formData = await formRef.submit()

    // Create the params object with correct structure
    const params: CreateCollectionParams = {
      name: formData.name,
      ...(formData.description ? { description: formData.description } : {}),
      icon: formData.icon,
      iconColor: formData.iconColor,
      isPublic: formData.isPublic,
    }

    if (props.collection) {
      // Update existing collection
      await collectionsService.updateCollection(props.collection.id, params)
    } else {
      // Create new collection
      await collectionsService.createCollection(params)
    }

    isOpen.value = false
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <ComponentDialog
    v-model:open="isOpen"
    :component="CollectionForm"
    :props="{ collection: props.collection }"
    :title="getDialogTitle()"
    :description="getDialogDescription()"
    :continue-text="props.collection ? t('general.save') : t('general.create')"
    :cancel-text="t('general.cancel')"
    :loading="isSubmitting"
    @submit="handleSubmit"
  />
</template>
