<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { MapPinIcon } from 'lucide-vue-next'
import BookmarkList from '@/components/library/BookmarkList.vue'
import EmptyState from '@/components/library/EmptyState.vue'
import { useCollectionsService } from '@/services/library/collections.service'

const collectionsService = useCollectionsService()

const loadingBookmarks = ref(false)
const defaultCollection = ref<any>(null)

onMounted(async () => {
  loadingBookmarks.value = true
  defaultCollection.value = await collectionsService.fetchDefaultCollection()
  loadingBookmarks.value = false
})

const showEmptyState = computed(() => {
  return (
    !loadingBookmarks.value &&
    (!defaultCollection.value ||
      !defaultCollection.value.bookmarks ||
      defaultCollection.value.bookmarks.length === 0)
  )
})

const loading = computed(() => {
  return (
    loadingBookmarks.value &&
    (!defaultCollection.value ||
      !defaultCollection.value.bookmarks ||
      defaultCollection.value.bookmarks.length === 0)
  )
})

const bookmarks = computed(() => {
  return defaultCollection.value?.bookmarks || []
})
</script>

<template>
  <div class="h-full flex flex-col">
    <EmptyState
      v-if="showEmptyState"
      :icon="MapPinIcon"
      entity-id="bookmarks"
      class="flex-1"
    />

    <BookmarkList
      v-else
      :bookmarks="bookmarks"
      :loading="loading"
      :collection-id="defaultCollection?.id"
    />
  </div>
</template>
