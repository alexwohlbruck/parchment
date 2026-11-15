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
import { ensureMarkerImage, markerImageId, type PlaceMark } from '@/lib/map-marker'
import { ensurePoiBadge, spriteLoaded } from '@/lib/map-style/badge-art'
import { poiBadgeTint } from '@/lib/map-style/build'
import { basemapPoiLook, type BasemapPoiLook } from '@/lib/map/basemap-poi-look'
import { getPlaceRouteFromExternalIds } from '@/lib/place/place-route'
import { mapPoiClickPolicy } from '@/lib/map/map-poi-interaction'
import {
  buildCollectionMarkersGeoJSON,
  collectionMarkerColor,
  collectionMarkerSpec,
  drawableBookmarks,
} from '@/lib/library/collection-markers'
import { filterByPlaceTypes } from '@/lib/library/place-type-filter'
import {
  COLLECTION_MARKERS_SOURCE_ID,
  COLLECTION_MARKERS_LAYER_ID,
  COLLECTION_LABELS_LAYER_ID,
  COLLECTION_MARKERS_LAYER_CONFIG,
  COLLECTION_LABELS_LAYER_CONFIG,
  collectionLabelPaint,
  poiLabelLayout,
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
  /** The basemap POI look this style's layers were built from. */
  let look: BasemapPoiLook | null = null
  let dataGeneration = 0

  const openBookmarks = computed<Bookmark[]>(() => {
    const store = useCollectionsStore()
    const id = store.openCollectionId
    return id
      ? filterByPlaceTypes(store.getCollectionPlaces(id), store.placeTypeFilter)
      : []
  })

  /** Basemap badges where the style composites them, the app's own markers elsewhere. */
  function markPlaces(map: any, bookmarks: Bookmark[]): Promise<PlaceMark[]> {
    const isDark = useThemeStore().isDark
    return Promise.all(
      bookmarks.map(async bookmark => {
        const spec = collectionMarkerSpec(bookmark, themeColorToHex, isDark)
        if (look?.badges) {
          const colors = poiBadgeTint(collectionMarkerColor(bookmark, themeColorToHex), isDark ? 'dark' : 'light')
          return { image: await ensurePoiBadge(map, spec, colors), ink: colors.ink }
        }
        await ensureMarkerImage(map, spec)
        return { image: markerImageId(spec), ink: spec.paint.ink }
      }),
    )
  }

  async function updateData(mapStrategy: MapStrategy) {
    const map = mapStrategy.mapInstance
    const generation = ++dataGeneration
    const bookmarks = drawableBookmarks(openBookmarks.value)
    if (look?.badges && !spriteLoaded(map)) {
      map.once('idle', () => {
        if (generation === dataGeneration && activeStrategy === mapStrategy) void updateData(mapStrategy)
      })
      return
    }
    // Images are registered before the data names them; a badge is composited
    // only when MapLibre first asks for it, and it asks once.
    const marks = await markPlaces(map, bookmarks)
    if (generation !== dataGeneration || activeStrategy !== mapStrategy) return

    bookmarksById = new Map(bookmarks.map(b => [b.id, b]))
    const source = map.getSource(COLLECTION_MARKERS_SOURCE_ID)
    if (source) (source as any).setData(buildCollectionMarkersGeoJSON(bookmarks, marks))
    for (const layerId of LAYER_IDS) {
      if (map.getLayer(layerId)) mapStrategy.toggleLayerVisibility(layerId, bookmarks.length > 0)
    }
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
      look = basemapPoiLook(map.getStyle()?.layers ?? [])
      mapStrategy.addLayer(toLayer(COLLECTION_MARKERS_LAYER_CONFIG))
    }
    if (!map.getLayer(COLLECTION_LABELS_LAYER_ID)) {
      const labels = toLayer(COLLECTION_LABELS_LAYER_CONFIG)
      labels.configuration = {
        ...labels.configuration,
        layout: poiLabelLayout(look),
        paint: { ...collectionLabelPaint(useThemeStore().isDark), ...look?.paint },
      }
      mapStrategy.addLayer(labels)
    }

    if (interactionBoundTo !== map) {
      registerInteraction(mapStrategy)
      interactionBoundTo = map
    }

    activeStrategy = mapStrategy
    initializeReactivity()
    void updateData(mapStrategy)
  }

  function initializeReactivity() {
    if (reactivityInitialized) return
    reactivityInitialized = true

    watch(
      () => [openBookmarks.value, useThemeStore().isDark],
      () => {
        if (activeStrategy) void updateData(activeStrategy)
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
