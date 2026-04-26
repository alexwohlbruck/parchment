<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useI18n } from 'vue-i18n'
import { useCollectionsService } from '@/services/library/collections.service'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { type ThemeColor } from '@/lib/utils'
import BookmarkList from '@/components/library/BookmarkList.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import CollectionContextMenu from '@/components/library/CollectionContextMenu.vue'
import DetailPanelLayout from '@/components/layouts/DetailPanelLayout.vue'
// NOTE: the in-view back button was removed — the drawer (LeftSheet /
// BottomSheet) now provides navigation controls. Route-change cleanup, if
// any, should live in onBeforeRouteLeave or the store.

const route = useRoute()
const router = useRouter()
const collectionsService = useCollectionsService()
const collectionsStore = useCollectionsStore()
const { t } = useI18n()

const id = route.params.id as string
const loading = ref(true)

const collection = computed(() => {
  return collectionsStore.getCollectionById(id)
})

const bookmarks = computed(() => collection.value?.bookmarks || [])

const collectionName = computed(() => {
  if (!collection.value) {
    return ''
  }
  return collectionsService.getCollectionDisplayName(collection.value)
})

onMounted(async () => {
  loading.value = true

  await collectionsService.fetchCollectionById(id)

  if (!collection.value) {
    router.push({ name: AppRoute.LIBRARY_COLLECTIONS })
    return
  }

  loading.value = false
})

function handleCollectionEdit() {
  collectionsService.fetchCollectionById(id)
}

function handleCollectionDelete() {
  router.push({ name: AppRoute.LIBRARY_COLLECTIONS })
}
</script>

<template>
  <div v-if="loading" class="h-full flex items-center justify-center">
    <div class="text-muted-foreground">
      {{ t('library.loading.collection') }}
    </div>
  </div>

  <DetailPanelLayout v-else-if="collection">
    <template #title>
      <div class="flex items-center gap-2 min-w-0">
        <ItemIcon
          :icon="collection.icon"
          :icon-pack="collection.iconPack ?? 'lucide'"
          :color="collection.iconColor as ThemeColor"
          size="sm"
        />
        <div class="min-w-0">
          <h1 class="text-lg font-semibold truncate">{{ collectionName }}</h1>
          <p
            v-if="collection.description"
            class="text-xs text-muted-foreground truncate"
          >
            {{ collection.description }}
          </p>
        </div>
      </div>
    </template>

    <template #actions>
      <CollectionContextMenu
        :collection="collection"
        :on-delete-success="handleCollectionDelete"
        @edit="handleCollectionEdit"
      />
    </template>

    <BookmarkList
      :bookmarks="bookmarks"
      :loading="loading"
      :collection-id="id"
    />
  </DetailPanelLayout>
</template>
