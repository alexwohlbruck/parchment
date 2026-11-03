/** The open collection's places, as labelled full-size POI markers over the saved-place dots. */

import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { MapStrategy } from '@/services/map/providers/map.strategy'
import type { Layer } from '@/types/map.types'
import type { Bookmark } from '@/types/library.types'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useThemeStore } from '@/stores/theme.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { themeColorToHex } from '@/lib/utils'
import { ensureMarkerImages } from '@/lib/map-marker'
import { getPlaceRouteFromExternalIds } from '@/lib/place/place-route'
import { mapPoiClickPolicy } from '@/lib/map/map-poi-interaction'
import {
  buildCollectionMarkersGeoJSON,
  collectionMarkerSpecs,
} from '@/lib/library/collection-markers'
import {
  COLLECTION_MARKERS_SOURCE_ID,
  COLLECTION_MARKERS_LAYER_ID,
  COLLECTION_LABELS_LAYER_ID,
  COLLECTION_MARKERS_LAYER_CONFIG,
  COLLECTION_LABELS_LAYER_CONFIG,
  collectionLabelPaint,
} from '@/constants/layers'

const LAYER_IDS = [COLLECTION_MARKERS_LAYER_ID, COLLECTION_LABELS_LAYER_ID]

function toLayer(
  config: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
): Layer {
  return {
    ...config,
    id: config.configuration.id,
    userId: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    visible: false,
  } as Layer
}

export function useCollectionMarkersLayerService() {
  const router = useRouter()

  let reactivityInitialized = false
  let interactionBoundTo: unknown = null
  /** Held in a slot rather than captured: an engine switch replaces the strategy. */
  let activeStrategy: MapStrategy | null = null
  let bookmarksById = new Map<string, Bookmark>()

  const openBookmarks = computed<Bookmark[]>(() => {
    const store = useCollectionsStore()
    const id = store.openCollectionId
    return id ? store.getCollectionPlaces(id) : []
  })

  function updateData(mapStrategy: MapStrategy) {
    const map = mapStrategy.mapInstance
    const bookmarks = openBookmarks.value
    const isDark = useThemeStore().isDark
    bookmarksById = new Map(bookmarks.map(b => [b.id, b]))

    const source = map.getSource(COLLECTION_MARKERS_SOURCE_ID)
    if (source) {
      ;(source as any).setData(
        buildCollectionMarkersGeoJSON(bookmarks, themeColorToHex, isDark),
      )
    }

    const visible = bookmarks.length > 0
    for (const layerId of LAYER_IDS) {
      if (map.getLayer(layerId)) mapStrategy.toggleLayerVisibility(layerId, visible)
    }

    if (!visible) return
    void ensureMarkerImages(
      map,
      collectionMarkerSpecs(bookmarks, themeColorToHex, isDark),
    ).then(() => map.triggerRepaint?.())
  }

  function registerInteraction(mapStrategy: MapStrategy) {
    const map = mapStrategy.mapInstance
    const canvas = map.getCanvas()

    map.on('mouseenter', COLLECTION_MARKERS_LAYER_ID, () => {
      if (!useMapToolsStore().rawClickCapture && mapPoiClickPolicy.enabled) {
        canvas.style.cursor = 'pointer'
      }
    })

    map.on('mouseleave', COLLECTION_MARKERS_LAYER_ID, () => {
      if (!useMapToolsStore().rawClickCapture) canvas.style.cursor = ''
    })

    map.on('click', COLLECTION_MARKERS_LAYER_ID, (e: any) => {
      const mapTools = useMapToolsStore()
      if (mapTools.activeTool === 'measure' || mapTools.rawClickCapture) return

      const bookmark = bookmarksById.get(e.features?.[0]?.properties?.id)
      const target = bookmark && getPlaceRouteFromExternalIds(bookmark.externalIds)
      if (!target) return

      if (mapStrategy.dispatchPoiClick(e, () => router.push(target))) {
        // Stop the generic map click from also dropping a pin.
        e.originalEvent?.stopPropagation?.()
      }
    })
  }

  /** Idempotent; called on every `style.load`, which drops sources, layers and images. */
  function initializeCollectionMarkersLayer(mapStrategy: MapStrategy) {
    if (!mapStrategy) return
    const map = mapStrategy.mapInstance

    if (!map.getSource(COLLECTION_MARKERS_SOURCE_ID)) {
      map.addSource(COLLECTION_MARKERS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      } as any)
    }

    if (!map.getLayer(COLLECTION_MARKERS_LAYER_ID)) {
      mapStrategy.addLayer(toLayer(COLLECTION_MARKERS_LAYER_CONFIG))
    }
    if (!map.getLayer(COLLECTION_LABELS_LAYER_ID)) {
      // Built per style load, since the halo follows the theme.
      const labels = toLayer(COLLECTION_LABELS_LAYER_CONFIG)
      labels.configuration = {
        ...labels.configuration,
        paint: collectionLabelPaint(useThemeStore().isDark),
      }
      mapStrategy.addLayer(labels)
    }

    if (interactionBoundTo !== map) {
      registerInteraction(mapStrategy)
      interactionBoundTo = map
    }

    activeStrategy = mapStrategy
    initializeReactivity()
    updateData(mapStrategy)
  }

  function initializeReactivity() {
    if (reactivityInitialized) return
    reactivityInitialized = true

    watch(
      () => [openBookmarks.value, useThemeStore().isDark],
      () => {
        if (activeStrategy) updateData(activeStrategy)
      },
    )
  }

  /** Teardown for map destruction, not for restyles. */
  function removeCollectionMarkersLayer(mapStrategy: MapStrategy) {
    if (!mapStrategy) return
    for (const layerId of LAYER_IDS) mapStrategy.removeLayer(layerId)
    mapStrategy.removeSource(COLLECTION_MARKERS_SOURCE_ID)
    interactionBoundTo = null
    activeStrategy = null
    bookmarksById = new Map()
  }

  return {
    initializeCollectionMarkersLayer,
    removeCollectionMarkersLayer,
  }
}
