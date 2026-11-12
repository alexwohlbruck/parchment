import { computed } from 'vue'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useRoutesStore } from '@/stores/library/routes.store'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import { useLayersStore } from '@/stores/layers.store'

export type ArchiveKind = 'collections' | 'routes' | 'layers' | 'canvases'

/** What the user has archived, per library tab. */
export function useArchivedItems() {
  const collectionsStore = useCollectionsStore()
  const routesStore = useRoutesStore()
  const canvasesStore = useCanvasesStore()
  const layersStore = useLayersStore()

  const collections = computed(() => collectionsStore.collections.filter(c => c.archivedAt))
  const routes = computed(() => routesStore.routes.filter(r => r.archivedAt))
  const canvases = computed(() => canvasesStore.canvases.filter(c => c.archivedAt))
  const layers = computed(() => layersStore.archivedItems)

  const counts = computed<Record<ArchiveKind, number>>(() => ({
    collections: collections.value.length,
    routes: routes.value.length,
    layers: layers.value.length,
    canvases: canvases.value.length,
  }))

  return { collections, routes, canvases, layers, counts }
}
