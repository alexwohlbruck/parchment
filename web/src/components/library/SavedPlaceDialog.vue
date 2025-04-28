<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import SavedPlaceForm from '@/components/library/SavedPlaceForm.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { useAppService } from '@/services/app.service'
import type { SavedPlace } from '@/types/library.types'

const props = defineProps<{
  place: SavedPlace
}>()

const { t } = useI18n()
const appService = useAppService()
const collectionsService = useCollectionsService()

function openSavedPlaceDialog(place: SavedPlace) {
  appService
    .componentDialog({
      component: SavedPlaceForm,
      title: t('library.dialog.editPlace.title'),
      description: t('library.dialog.editPlace.description'),
      continueText: t('general.save'),
      cancelText: t('general.cancel'),
      props: {
        place,
      },
    })
    .then(async formData => {
      console.log('Form data received in dialog:', formData)
      if (!formData) return

      const params = {
        name: formData.name,
        ...(formData.type ? { presetType: formData.type } : {}),
        icon: formData.icon,
        iconColor: formData.iconColor,
      }

      console.log('Sending to API:', params)

      // Get the default collection and update the place in it
      const defaultCollection =
        await collectionsService.fetchDefaultCollection()
      if (defaultCollection) {
        await collectionsService.updatePlaceInCollection(
          place.id,
          defaultCollection.id,
          params,
        )
      }
    })
}

// Auto-open the dialog when the component is mounted
onMounted(() => {
  openSavedPlaceDialog(props.place)
})
</script>

<template>
  <!-- This component doesn't render anything in the template -->
</template>
