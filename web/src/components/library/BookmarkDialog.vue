<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import BookmarkForm from '@/components/library/BookmarkForm.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { useAppService } from '@/services/app.service'
import type { Bookmark } from '@/types/library.types'

const props = defineProps<{
  place: Bookmark
}>()

const { t } = useI18n()
const appService = useAppService()
const collectionsService = useCollectionsService()
const bookmarksService = useBookmarksService()

function openBookmarkDialog(place: Bookmark) {
  appService
    .componentDialog({
      component: BookmarkForm,
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

      await bookmarksService.updateBookmark(place.id, params)
    })
}

onMounted(() => {
  openBookmarkDialog(props.place)
})
</script>

<template></template>
