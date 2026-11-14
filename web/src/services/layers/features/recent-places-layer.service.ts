/** Places the user recently opened, as quiet markers they can tap to get back to. */

import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import type { MapStrategy } from '@/services/map/providers/map.strategy'
import type { Layer } from '@/types/map.types'
import type { ExternalIds } from '@/lib/library/external-ids'
import { usePlaceService } from '@/services/place/place.service'
import { useAuthStore } from '@/stores/auth.store'
import { useRecentsStore } from '@/stores/recents.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useEncryptedPointsStore } from '@/stores/library/encrypted-points.store'
import { useLayersStore } from '@/stores/layers.store'
import { useThemeStore } from '@/stores/theme.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { ensureMarkerImages } from '@/lib/map-marker'
import { getPlaceRoute } from '@/lib/place/place-route'
import { mapPoiClickPolicy } from '@/lib/map/map-poi-interaction'
import {
  RECENT_PLACES_TOGGLE_ID,
  buildRecentPlacesGeoJSON,
  recentPlaceMarkerSpec,
  selectRecentPlaceMarkers,
  type DrawableRecentPlace,
} from '@/lib/recents/recent-place-markers'
import {
  RECENT_PLACES_SOURCE_ID,
  RECENT_PLACES_LAYER_ID,
  RECENT_PLACES_LABELS_LAYER_ID,
  RECENT_PLACES_LAYER_CONFIG,
  RECENT_PLACES_LABELS_LAYER_CONFIG,
  collectionLabelPaint,
} from '@/constants/layers'

const LAYER_IDS = [RECENT_PLACES_LAYER_ID, RECENT_PLACES_LABELS_LAYER_ID]

function isPlaceRoute(name: unknown): boolean {
  return [
    AppRoute.PLACE,
    AppRoute.PLACE_PROVIDER,
    AppRoute.PLACE_LOCATION,
    AppRoute.PLACE_COORDS,
  ].includes(name as AppRoute)
}

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

export function useRecentPlacesLayerService() {
  const router = useRouter()
  const { currentPlace } = usePlaceService()

  let reactivityInitialized = false
  let boundMap: any = null
  /** Held in a slot rather than captured: an engine switch replaces the strategy. */
  let activeStrategy: MapStrategy | null = null
  let placesById = new Map<string, DrawableRecentPlace>()

  const enabled = computed(
    () =>
      !!useAuthStore().me &&
      (useLayersStore().getLayerVisibilityOverride(RECENT_PLACES_TOGGLE_ID) ?? true),
  )

  const selectedId = computed(() =>
    isPlaceRoute(router.currentRoute.value.name)
      ? (currentPlace.value?.id ?? null)
      : null,
  )

  const savedIds = computed<ExternalIds[]>(() => [
    ...useBookmarksStore().bookmarks.map(b => b.externalIds ?? {}),
    ...Object.values(useEncryptedPointsStore().pointsByCollection)
      .flat()
      .map(p => p.externalIds ?? {}),
  ])

  const places = computed<DrawableRecentPlace[]>(() =>
    enabled.value
      ? selectRecentPlaceMarkers({
          entries: useRecentsStore().places,
          saved: savedIds.value,
          selectedId: selectedId.value,
        })
      : [],
  )

  function updateData(mapStrategy: MapStrategy) {
    const map = mapStrategy.mapInstance
    const isDark = useThemeStore().isDark
    const drawn = places.value
    placesById = new Map(drawn.map(p => [p.id, p]))

    const source = map.getSource(RECENT_PLACES_SOURCE_ID)
    if (source) (source as any).setData(buildRecentPlacesGeoJSON(drawn, isDark))

    const visible = drawn.length > 0
    for (const layerId of LAYER_IDS) {
      if (map.getLayer(layerId)) mapStrategy.toggleLayerVisibility(layerId, visible)
    }

    if (!visible) return
    void ensureMarkerImages(
      map,
      drawn.map(p => recentPlaceMarkerSpec(p, isDark)),
    ).then(() => map.triggerRepaint?.())
  }

  function onMouseEnter() {
    if (!useMapToolsStore().rawClickCapture && mapPoiClickPolicy.enabled) {
      boundMap.getCanvas().style.cursor = 'pointer'
    }
  }

  function onMouseLeave() {
    if (!useMapToolsStore().rawClickCapture) boundMap.getCanvas().style.cursor = ''
  }

  function onClick(e: any) {
    const mapTools = useMapToolsStore()
    if (mapTools.activeTool === 'measure' || mapTools.rawClickCapture) return
    const place = placesById.get(e.features?.[0]?.properties?.id)
    if (!place || !activeStrategy) return
    if (activeStrategy.dispatchPoiClick(e, () => router.push(getPlaceRoute(place.id)))) {
      e.originalEvent?.stopPropagation?.()
    }
  }

  function bindInteraction(map: any) {
    map.on('mouseenter', RECENT_PLACES_LAYER_ID, onMouseEnter)
    map.on('mouseleave', RECENT_PLACES_LAYER_ID, onMouseLeave)
    map.on('click', RECENT_PLACES_LAYER_ID, onClick)
    boundMap = map
  }

  function unbindInteraction() {
    if (!boundMap) return
    boundMap.off('mouseenter', RECENT_PLACES_LAYER_ID, onMouseEnter)
    boundMap.off('mouseleave', RECENT_PLACES_LAYER_ID, onMouseLeave)
    boundMap.off('click', RECENT_PLACES_LAYER_ID, onClick)
    boundMap = null
  }

  /** Idempotent; called on every `style.load`, which drops sources, layers and images. */
  function initializeRecentPlacesLayer(mapStrategy: MapStrategy) {
    if (!mapStrategy) return
    const map = mapStrategy.mapInstance

    if (!map.getSource(RECENT_PLACES_SOURCE_ID)) {
      map.addSource(RECENT_PLACES_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      } as any)
    }

    if (!map.getLayer(RECENT_PLACES_LAYER_ID)) {
      mapStrategy.addLayer(toLayer(RECENT_PLACES_LAYER_CONFIG))
    }
    if (!map.getLayer(RECENT_PLACES_LABELS_LAYER_ID)) {
      const labels = toLayer(RECENT_PLACES_LABELS_LAYER_CONFIG)
      labels.configuration = {
        ...labels.configuration,
        paint: collectionLabelPaint(useThemeStore().isDark),
      }
      mapStrategy.addLayer(labels)
    }

    if (boundMap !== map) {
      unbindInteraction()
      bindInteraction(map)
    }

    activeStrategy = mapStrategy
    initializeReactivity()
    updateData(mapStrategy)
  }

  function initializeReactivity() {
    if (reactivityInitialized) return
    reactivityInitialized = true

    watch(
      () => [places.value, useThemeStore().isDark],
      () => {
        if (activeStrategy) updateData(activeStrategy)
      },
    )
  }

  /** Teardown for map destruction, not for restyles. */
  function removeRecentPlacesLayer(mapStrategy: MapStrategy) {
    if (!mapStrategy) return
    unbindInteraction()
    for (const layerId of LAYER_IDS) mapStrategy.removeLayer(layerId)
    mapStrategy.removeSource(RECENT_PLACES_SOURCE_ID)
    activeStrategy = null
    placesById = new Map()
  }

  return {
    initializeRecentPlacesLayer,
    removeRecentPlacesLayer,
  }
}
