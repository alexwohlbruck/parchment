<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArchiveIcon } from 'lucide-vue-next'
import DetailPanelLayout from '@/components/sheet/layouts/DetailPanelLayout.vue'
import { EmptyState } from '@/components/ui/empty-state'
import CollectionCard from '@/components/library/collections/CollectionCard.vue'
import RouteCard from '@/components/library/routes/RouteCard.vue'
import CanvasCard from '@/components/library/canvas/CanvasCard.vue'
import ArchivedLayerRow from '@/components/library/layers/ArchivedLayerRow.vue'
import CanvasDialog from '@/components/library/canvas/CanvasDialog.vue'
import { useArchivedItems, type ArchiveKind } from '@/composables/library/useArchivedItems'
import { useCollectionsService } from '@/services/library/collections.service'
import { useRoutesService } from '@/services/library/routes.service'
import { useCanvasesService } from '@/services/library/canvases.service'
import { useLayersStore } from '@/stores/layers.store'
import type { Canvas } from '@/types/canvas.types'

const props = defineProps<{ kind: ArchiveKind }>()

const { t } = useI18n()
const archived = useArchivedItems()
const collectionsService = useCollectionsService()
const routesService = useRoutesService()
const canvasesService = useCanvasesService()
const layersStore = useLayersStore()

const LOADERS: Record<ArchiveKind, () => Promise<unknown>> = {
  collections: () => collectionsService.fetchCollections(),
  routes: () => routesService.fetchRoutes(),
  layers: () => layersStore.loadLayers(),
  canvases: () => canvasesService.fetchCanvases(),
}

onMounted(() => LOADERS[props.kind]().catch(() => {}))

const renaming = ref<Canvas | null>(null)

const isEmpty = computed(() => archived.counts.value[props.kind] === 0)
</script>

<template>
  <DetailPanelLayout :title="t(`library.archive.title.${kind}`)">
    <EmptyState
      v-if="isEmpty"
      :icon="ArchiveIcon"
      :title="t('library.archive.empty')"
      class="mt-12"
    />

    <div v-else class="flex flex-col gap-2">
      <template v-if="kind === 'collections'">
        <CollectionCard
          v-for="collection in archived.collections.value"
          :key="collection.id"
          :collection="collection"
        />
      </template>
      <template v-else-if="kind === 'routes'">
        <RouteCard v-for="route in archived.routes.value" :key="route.id" :route="route" />
      </template>
      <template v-else-if="kind === 'layers'">
        <ArchivedLayerRow v-for="item in archived.layers.value" :key="item.id" :item="item" />
      </template>
      <template v-else>
        <CanvasCard
          v-for="canvas in archived.canvases.value"
          :key="canvas.id"
          :canvas="canvas"
          @rename="renaming = $event"
        />
      </template>
    </div>
  </DetailPanelLayout>

  <CanvasDialog
    :open="!!renaming"
    :canvas="renaming"
    @update:open="open => !open && (renaming = null)"
  />
</template>
