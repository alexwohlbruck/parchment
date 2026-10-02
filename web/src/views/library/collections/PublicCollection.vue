<script setup lang="ts">
/**
 * A collection someone shared by link, read-only. Reachable signed out, so it
 * reads the public endpoint and stays out of the viewer's own library.
 */
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LinkIcon } from 'lucide-vue-next'
import { useCollectionsService } from '@/services/library/collections.service'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useMapService } from '@/services/map/map.service'
import { boundsOfPoints } from '@/lib/geo/map-bounds'
import { collectionIcon } from '@/lib/library/collection-display'
import DetailPanelLayout from '@/components/sheet/layouts/DetailPanelLayout.vue'
import PlaceCard from '@/components/place/card/PlaceCard.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import type { Bookmark, Collection } from '@/types/library.types'

const props = defineProps<{ token: string }>()

const { t } = useI18n()
const collectionsService = useCollectionsService()
const collectionsStore = useCollectionsStore()
const mapService = useMapService()

const collection = ref<Collection | null>(null)
const places = ref<Bookmark[]>([])
const loading = ref(true)

const title = computed(
  () => collection.value?.name || t('library.entities.collections.untitled'),
)

;(async () => {
  const shared = await collectionsService.fetchPublicCollection(props.token)
  loading.value = false
  if (!shared) return
  collection.value = shared.collection
  places.value = shared.places
  collectionsStore.publicCollection = { id: shared.collection.id, places: shared.places }
  collectionsStore.openCollectionId = shared.collection.id
  const bounds = boundsOfPoints(shared.places)
  if (bounds) mapService.fitBounds(bounds, { maxZoom: 15 })
})()

onUnmounted(() => {
  if (collectionsStore.openCollectionId === collection.value?.id) {
    collectionsStore.openCollectionId = null
  }
  collectionsStore.publicCollection = null
})
</script>

<template>
  <DetailPanelLayout>
    <template #title>
      <div v-if="collection" class="flex items-center gap-2 min-w-0">
        <ItemIcon v-bind="collectionIcon(collection)" size="sm" />
        <div class="min-w-0">
          <h4 class="text-base font-semibold truncate">{{ title }}</h4>
          <p class="text-xs text-muted-foreground truncate">
            {{ collection.description || t('library.entities.collections.public.subtitle') }}
          </p>
        </div>
      </div>
    </template>

    <div v-if="loading" class="py-12 flex justify-center">
      <Spinner />
    </div>

    <div v-else-if="!collection" class="py-12">
      <EmptyState
        :icon="LinkIcon"
        :title="t('library.entities.collections.public.gone.title')"
        :description="t('library.entities.collections.public.gone.description')"
      />
    </div>

    <div v-else class="flex flex-col gap-2 pb-4">
      <PlaceCard
        v-for="place in places"
        :key="place.id"
        :bookmark="place"
        variant="row"
        size="md"
      />
    </div>
  </DetailPanelLayout>
</template>
