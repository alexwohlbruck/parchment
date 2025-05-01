<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { AppRoute } from '@/router'
import { useI18n } from 'vue-i18n'
import { ArrowLeftIcon } from 'lucide-vue-next'
import { useCollectionsService } from '@/services/library/collections.service'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { type ThemeColor } from '@/lib/utils'
import BookmarkList from '@/components/library/BookmarkList.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import CollectionContextMenu from '@/components/library/CollectionContextMenu.vue'

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

function goBack() {
  router.push({ name: AppRoute.LIBRARY_COLLECTIONS })
}

function handleCollectionEdit() {
  collectionsService.fetchCollectionById(id)
}

function handleCollectionDelete() {
  router.push({ name: AppRoute.LIBRARY_COLLECTIONS })
}
</script>

<template>
  <div class="h-full flex flex-col p-4 gap-4">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="text-muted-foreground">
        {{ t('library.loading.collection') }}
      </div>
    </div>

    <template v-else-if="collection">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="icon" @click="goBack">
            <ArrowLeftIcon class="size-4" />
          </Button>

          <div class="flex items-center gap-3">
            <ItemIcon
              :icon="collection.icon"
              :color="collection.iconColor as ThemeColor"
              size="md"
            />
            <div>
              <h1 class="text-xl font-semibold">{{ collectionName }}</h1>
              <p
                v-if="collection.description"
                class="text-sm text-muted-foreground"
              >
                {{ collection.description }}
              </p>
            </div>
          </div>
        </div>

        <CollectionContextMenu
          :collection="collection"
          :on-delete-success="handleCollectionDelete"
          @edit="handleCollectionEdit"
        />
      </div>

      <BookmarkList
        :bookmarks="bookmarks"
        :loading="loading"
        :collection-id="id"
      />
    </template>
  </div>
</template>
