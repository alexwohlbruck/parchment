/**
 * Saved places layer.
 *
 * Draws the user's bookmarks — and the decrypted points of any E2EE
 * collection they've switched on — as two native layers over one GeoJSON
 * source: a circle per place, and its collection's glyph once the dot is big
 * enough to hold one. Nothing here mounts DOM, so a user with thousands of
 * saved places costs the same as one with a dozen.
 *
 * Visibility is driven by the virtual "Saved places" group in the layer
 * selector: the group toggle plus one toggle per collection. Filtering
 * rebuilds the source rather than calling `setFilter`, because membership is
 * an array property and rebuilding a few thousand features is microseconds.
 */

import { watch } from 'vue'
import { useRouter } from 'vue-router'
import type { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useEncryptedPointsStore } from '@/stores/library/encrypted-points.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useCollectionsService } from '@/services/library/collections.service'
import { useLayersStore } from '@/stores/layers.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import type { Layer } from '@/types/map.types'
import { ensureIconImages } from '@/lib/map-icon-images'
import { themeColorToHex } from '@/lib/utils'
import { getPlaceRouteFromExternalIds } from '@/lib/place.utils'
import {
  selectSavedPlaces,
  buildSavedPlacesGeoJSON,
  savedPlaceIconSpecs,
  type SavedPlace,
  type CollectionStyle,
} from '@/lib/saved-places-features'
import {
  BOOKMARKS_SOURCE_ID,
  BOOKMARKS_CIRCLES_LAYER_ID,
  BOOKMARKS_ICONS_LAYER_ID,
  BOOKMARKS_CIRCLES_LAYER_CONFIG,
  BOOKMARKS_ICONS_LAYER_CONFIG,
  EMPTY_BOOKMARKS_GEOJSON,
} from '@/constants/layers'

const LAYER_CONFIGS = [
  BOOKMARKS_CIRCLES_LAYER_CONFIG,
  BOOKMARKS_ICONS_LAYER_CONFIG,
]
const LAYER_IDS = [
  BOOKMARKS_CIRCLES_LAYER_ID,
  BOOKMARKS_ICONS_LAYER_ID,
]

function toLayer(
  config: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  visible: boolean,
): Layer {
  return {
    ...config,
    id: config.configuration.id,
    userId: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    visible,
  } as Layer
}

export function useBookmarksLayerService() {
  const router = useRouter()
  // Constructed HERE, not lazily inside the watcher. `useCollectionsService`
  // is a shared composable that calls `useI18n()`, which throws outside a
  // component setup — and `createSharedComposable` caches the half-built
  // scope, so one bad call from a watcher leaves every later caller in the
  // app holding `undefined`. This service is built during Map.vue's setup,
  // so constructing it now is the safe moment.
  const collectionsService = useCollectionsService()

  let reactivityInitialized = false
  let interactionBoundTo: unknown = null
  /**
   * The strategy the watcher should draw into. Held in a mutable slot rather
   * than captured: the watcher is registered once, but the map can be rebuilt
   * under it (an engine switch replaces the strategy), and a captured
   * reference would leave every later update painting a dead map.
   */
  let activeStrategy: MapStrategy | null = null
  /** Feature id → its source record, so clicks can route without a store scan. */
  let placesById = new Map<string, SavedPlace>()

  // ==========================================================================
  // RENDER
  // ==========================================================================

  /**
   * Each collection's look, keyed by id — a place on the map wears its parent
   * collection's icon and colour rather than its own.
   */
  function collectionStyles(): Record<string, CollectionStyle> {
    const styles: Record<string, CollectionStyle> = {}
    for (const collection of useCollectionsStore().collections) {
      styles[collection.id] = {
        icon: collection.icon,
        iconPack: collection.iconPack,
        iconColor: collection.iconColor,
      }
    }
    return styles
  }

  function updateData(mapStrategy: MapStrategy) {
    const map = mapStrategy.mapInstance
    const places = selectSavedPlaces({
      bookmarks: useBookmarksStore().bookmarks,
      pointsByCollection: useEncryptedPointsStore().pointsByCollection,
      visibility: useLayersStore().savedPlacesVisibility,
      collectionStyles: collectionStyles(),
      // `iconColor` is a ThemeColor name for anything saved through the app;
      // paint expressions need a literal colour.
      resolveColor: themeColorToHex,
    })
    placesById = new Map(places.map(p => [p.id, p]))

    const source = map.getSource(BOOKMARKS_SOURCE_ID)
    if (source) (source as any).setData(buildSavedPlacesGeoJSON(places))

    // A layer with no features still costs a draw call and keeps its
    // interaction handlers live, so hide the whole set when empty.
    const hasPlaces = places.length > 0
    for (const layerId of LAYER_IDS) {
      if (map.getLayer(layerId)) {
        mapStrategy.toggleLayerVisibility(layerId, hasPlaces)
      }
    }

    // Rasterizing a glyph is async, so a place saved with a not-yet-seen icon
    // draws as a bare dot for a frame or two before the glyph lands.
    void ensureIconImages(map, savedPlaceIconSpecs(places)).then(() => {
      if (hasPlaces) map.triggerRepaint?.()
    })
  }

  // ==========================================================================
  // INTERACTION
  // ==========================================================================

  function registerInteraction(mapStrategy: MapStrategy) {
    const map = mapStrategy.mapInstance
    const canvas = map.getCanvas()

    // Hover changes the cursor and nothing else — a dot that grows under the
    // pointer shifts the thing you're aiming at.
    map.on('mouseenter', BOOKMARKS_CIRCLES_LAYER_ID, () => {
      canvas.style.cursor = 'pointer'
    })

    map.on('mouseleave', BOOKMARKS_CIRCLES_LAYER_ID, () => {
      canvas.style.cursor = ''
    })

    map.on('click', BOOKMARKS_CIRCLES_LAYER_ID, (e: any) => {
      // Measuring takes precedence: a click there is placing a vertex, not
      // opening a place. Mirrors the basemap POI handler.
      if (useMapToolsStore().activeTool === 'measure') return

      const id = e.features?.[0]?.properties?.id
      if (typeof id !== 'string') return
      const place = placesById.get(id)
      if (!place) return

      // Same resolution a bookmark card uses, so a dot and a list row open
      // the same page. Null when the place has no id to route to.
      const target = getPlaceRouteFromExternalIds(place.externalIds)
      if (!target) return

      // Stop the generic map click from also firing and dropping a pin.
      e.originalEvent?.stopPropagation?.()
      router.push(target)
    })
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Idempotent, and safe to call on every `style.load` — which is required,
   * because `setStyle` drops the source, the layers and the registered icon
   * images. Existence is checked against the map itself rather than a flag,
   * so a restyle self-heals instead of silently leaving the layer missing.
   */
  function initializeBookmarksLayer(mapStrategy: MapStrategy) {
    if (!mapStrategy) return
    const map = mapStrategy.mapInstance

    // Add the source directly so it is guaranteed present before the layers
    // reference it (the strategy's addLayer bails when the source is missing).
    if (!map.getSource(BOOKMARKS_SOURCE_ID)) {
      map.addSource(BOOKMARKS_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_BOOKMARKS_GEOJSON,
      } as any)
    }

    // Through the strategy, so the Mapbox-only expressions in these configs
    // (measure-light, symbol-z-elevate) get converted for MapLibre.
    for (const config of LAYER_CONFIGS) {
      if (!map.getLayer(config.configuration.id)) {
        mapStrategy.addLayer(toLayer(config, false))
      }
    }

    // Layer-scoped delegates survive setStyle (they resolve the layer per
    // event), so they're bound once per map instance, not per style.
    if (!interactionBoundTo || interactionBoundTo !== map) {
      registerInteraction(mapStrategy)
      interactionBoundTo = map
    }

    activeStrategy = mapStrategy
    // Runs `updateData` immediately on first call, and again on every change.
    initializeReactivity()
    // A restyle drops the source and re-adds it empty, but the watcher was
    // already registered, so nothing would refill it without this.
    updateData(mapStrategy)
  }

  /**
   * Pull in the points of any E2EE collection the user has just switched on.
   *
   * Decryption is deferred to this moment rather than done at boot: it is
   * per-point work for data the user hasn't asked to see yet, and the
   * plaintext is deliberately session-only. The store dedupes, so re-toggling
   * a collection costs nothing.
   */
  function loadVisibleEncryptedPoints() {
    const layersStore = useLayersStore()
    const { enabled, collectionIds } = layersStore.savedPlacesVisibility
    if (!enabled || collectionIds.size === 0) return

    const pointsStore = useEncryptedPointsStore()

    for (const collection of useCollectionsStore().collections) {
      if (collection.scheme !== 'user-e2ee') continue
      if (!collectionIds.has(collection.id)) continue
      if (pointsStore.isLoaded(collection.id)) continue
      void collectionsService.fetchAndDecryptPoints(collection)
    }
  }

  function initializeReactivity() {
    if (reactivityInitialized) return
    reactivityInitialized = true

    const bookmarksStore = useBookmarksStore()
    const layersStore = useLayersStore()
    const pointsStore = useEncryptedPointsStore()

    const collectionsStore = useCollectionsStore()

    watch(
      () => [
        bookmarksStore.bookmarks,
        layersStore.savedPlacesVisibility,
        pointsStore.pointsByCollection,
        // Places wear their collection's look, so renaming or recolouring a
        // collection has to redraw them.
        collectionsStore.collections,
      ],
      () => {
        loadVisibleEncryptedPoints()
        if (activeStrategy) updateData(activeStrategy)
      },
      // `immediate` rather than a separate priming call: the layer's data has
      // exactly one code path into it, so there is no ordering to get wrong
      // when bookmarks land before or after the style does.
      { deep: true, immediate: true },
    )
  }

  /** Teardown for map destruction, not for restyles. */
  function removeBookmarksLayer(mapStrategy: MapStrategy) {
    if (!mapStrategy) return
    for (const layerId of LAYER_IDS) mapStrategy.removeLayer(layerId)
    mapStrategy.removeSource(BOOKMARKS_SOURCE_ID)
    interactionBoundTo = null
    activeStrategy = null
    placesById = new Map()
  }

  return {
    initializeBookmarksLayer,
    removeBookmarksLayer,
  }
}
