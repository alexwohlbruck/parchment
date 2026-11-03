<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useI18n } from 'vue-i18n'
import { useCollectionsService } from '@/services/library/collections.service'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useMapService } from '@/services/map/map.service'
import { boundsOfPoints } from '@/lib/geo/map-bounds'
import { collectionIcon } from '@/lib/library/collection-display'
import { useBookmarksService } from '@/services/library/bookmarks.service'
import { useEncryptedPointsStore } from '@/stores/library/encrypted-points.store'
import type { Bookmark } from '@/types/library.types'
import { LockIcon } from 'lucide-vue-next'
import BookmarkList from '@/components/library/bookmarks/BookmarkList.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import CollectionContextMenu from '@/components/library/collections/CollectionContextMenu.vue'
import CollectionLockedNotice from '@/components/library/collections/CollectionLockedNotice.vue'
import DetailPanelLayout from '@/components/sheet/layouts/DetailPanelLayout.vue'
// NOTE: the in-view back button was removed — the drawer (LeftSheet /
// BottomSheet) now provides navigation controls. Route-change cleanup, if
// any, should live in onBeforeRouteLeave or the store.

const route = useRoute()
const router = useRouter()
const collectionsService = useCollectionsService()
const collectionsStore = useCollectionsStore()
const mapService = useMapService()
const { t } = useI18n()

const id = route.params.id as string
const loading = ref(true)

const collection = computed(() => {
  return collectionsStore.getCollectionById(id)
})

const bookmarksService = useBookmarksService()
const pointsStore = useEncryptedPointsStore()
const isPrivate = computed(() => collection.value?.scheme === 'user-e2ee')

const bookmarks = computed(() => collectionsStore.getCollectionPlaces(id))

async function removePrivatePlace(bookmark: Bookmark) {
  const point = pointsStore.getPoints(id).find(p => p.id === bookmark.id)
  if (collection.value && point) {
    await bookmarksService.removeFromPrivateCollection(collection.value, point)
  }
}

const collectionName = computed(() => {
  if (!collection.value) {
    return ''
  }
  return collectionsService.getCollectionDisplayName(collection.value)
})

let framed = false

/** Fits the camera once, as soon as any of the collection's places are known. */
watch(
  () => bookmarks.value.length,
  () => {
    const bounds = !framed && boundsOfPoints(bookmarks.value)
    if (!bounds) return
    framed = true
    mapService.fitBounds(bounds, { maxZoom: 15 })
  },
  { immediate: true },
)

onMounted(async () => {
  loading.value = true
  collectionsStore.openCollectionId = id

  await collectionsService.fetchCollectionById(id)

  if (!collection.value) {
    router.push({ name: AppRoute.LIBRARY_COLLECTIONS })
    return
  }
  if (isPrivate.value && !collection.value.locked) {
    await collectionsService.fetchAndDecryptPoints(collection.value)
  }

  loading.value = false
})

onUnmounted(() => {
  if (collectionsStore.openCollectionId === id) {
    collectionsStore.openCollectionId = null
  }
})

function handleCollectionEdit() {
  collectionsService.fetchCollectionById(id)
}

async function handleUnlocked() {
  await collectionsService.fetchCollections()
  const unlocked = await collectionsService.fetchCollectionById(id)
  if (unlocked?.scheme === 'user-e2ee' && !unlocked.locked) {
    pointsStore.clearCollection(id)
    await collectionsService.fetchAndDecryptPoints(unlocked)
  }
}

function handleCollectionDelete() {
  router.push({ name: AppRoute.LIBRARY_COLLECTIONS })
}
</script>

<template>
  <div v-if="loading" class="min-h-full flex items-center justify-center">
    <div class="text-muted-foreground">
      {{ t('library.loading.collection') }}
    </div>
  </div>

  <DetailPanelLayout v-else-if="collection">
    <template #title>
      <div class="flex items-center gap-2 min-w-0">
        <ItemIcon v-bind="collectionIcon(collection)" size="sm" />
        <div class="min-w-0">
          <h4 class="text-base font-semibold truncate flex items-center gap-1.5">
            <span class="truncate">{{ collectionName }}</span>
            <LockIcon
              v-if="isPrivate && !collection.locked"
              class="size-3.5 text-muted-foreground shrink-0"
            />
          </h4>
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

    <CollectionLockedNotice
      v-if="collection.locked"
      :collection="collection"
      @unlocked="handleUnlocked"
    />
    <BookmarkList
      v-else
      :bookmarks="bookmarks"
      :loading="loading"
      :collection-id="id"
      :encrypted="isPrivate"
      @remove="removePrivatePlace"
    />
  </DetailPanelLayout>
</template>
