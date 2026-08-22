/**
 * Draws canvases on the map.
 *
 * Used twice, with the same code: the map draws every canvas the user has
 * switched on, and the canvas editor draws the one being edited (its working
 * copy, so reordering and toggling read immediately). Both hand over a list;
 * this reconciles it against what is currently on the map.
 *
 * Every id is namespaced by canvas so two canvases can borrow the same
 * library layer, or carry style layers that happen to share a source name,
 * without colliding with each other or with the library's own copy.
 */

import { onScopeDispose, watch, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import { useLayersStore } from '@/stores/layers.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useEncryptedPointsStore } from '@/stores/library/encrypted-points.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import type { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { MARKER_RENDERED_LAYER_TYPES, type Layer } from '@/types/map.types'
import type { CanvasBody, CanvasLayer } from '@/types/canvas.types'
import {
  selectSavedPlaces,
  buildSavedPlacesGeoJSON,
  savedPlaceIconSpecs,
  type CollectionStyle,
} from '@/lib/saved-places-features'
import { ensureIconImages } from '@/lib/map-icon-images'
import { themeColorToHex } from '@/lib/utils'
import {
  BOOKMARKS_CIRCLES_LAYER_CONFIG,
  BOOKMARKS_ICONS_LAYER_CONFIG,
} from '@/constants/layers'

export interface RenderableCanvas {
  id: string
  body: CanvasBody
}

/** `canvas-<canvasId>-<layerId>`, with a suffix for multi-layer kinds. */
function scopedId(canvasId: string, layerId: string, suffix = '') {
  return `canvas-${canvasId}-${layerId}${suffix}`
}

function toLayer(
  id: string,
  configuration: Record<string, unknown>,
  visible: boolean,
): Layer {
  return {
    id,
    name: id,
    showInLayerSelector: false,
    visible,
    order: 0,
    groupId: null,
    configuration: { ...configuration, id },
  } as unknown as Layer
}

export function useCanvasRendering(
  canvases: ComputedRef<RenderableCanvas[]>,
  options: { key: string },
) {
  const mapStore = useMapStore()
  const layersStore = useLayersStore()
  const collectionsStore = useCollectionsStore()
  const bookmarksStore = useBookmarksStore()
  const pointsStore = useEncryptedPointsStore()
  const { layers: libraryLayers } = storeToRefs(layersStore)

  /** Every map id this instance has put on the map, so it can take them off. */
  let mounted = new Set<string>()
  let mountedSources = new Set<string>()

  function collectionPlaces(layer: CanvasLayer & { kind: 'collection' }) {
    const collection = collectionsStore.collections.find(
      c => c.id === layer.collectionId,
    )
    const style: CollectionStyle = {
      icon: layer.icon ?? collection?.icon,
      iconPack: collection?.iconPack,
      iconColor: layer.iconColor ?? collection?.iconColor,
    }
    return selectSavedPlaces({
      bookmarks: bookmarksStore.bookmarks,
      pointsByCollection: pointsStore.pointsByCollection,
      visibility: {
        enabled: true,
        frequents: false,
        uncategorized: false,
        collectionIds: new Set([layer.collectionId]),
      },
      collectionStyles: { [layer.collectionId]: style },
      resolveColor: themeColorToHex,
    })
  }

  /**
   * The map operations one canvas layer needs. Returned rather than applied
   * so `render` can diff the whole set before touching the map.
   */
  function planLayer(
    strategy: MapStrategy,
    canvasId: string,
    layer: CanvasLayer,
  ): { layers: Layer[]; sources: string[] } {
    if (layer.kind === 'style') {
      const id = scopedId(canvasId, layer.id)
      const configuration = { ...layer.configuration }
      const source = configuration.source
      if (source && typeof source === 'object') {
        configuration.source = {
          ...(source as Record<string, unknown>),
          id: scopedId(canvasId, layer.id, '-source'),
        }
      }
      return {
        layers: [toLayer(id, configuration, layer.visible)],
        sources: [scopedId(canvasId, layer.id, '-source')],
      }
    }

    if (layer.kind === 'library') {
      const source = libraryLayers.value.find(l => l.id === layer.layerId)
      // A borrowed layer that no longer exists, or one drawn as Vue markers
      // rather than a style layer (friends, trackers, notes), has nothing to
      // copy onto the canvas.
      if (!source || MARKER_RENDERED_LAYER_TYPES.has(source.type)) {
        return { layers: [], sources: [] }
      }
      const id = scopedId(canvasId, layer.id)
      const configuration = { ...source.configuration } as Record<string, unknown>
      const sourceSpec = configuration.source
      const sourceId = scopedId(canvasId, layer.id, '-source')
      if (sourceSpec && typeof sourceSpec === 'object') {
        configuration.source = {
          ...(sourceSpec as Record<string, unknown>),
          id: sourceId,
        }
        return {
          layers: [toLayer(id, configuration, layer.visible)],
          sources: [sourceId],
        }
      }
      // The library layer names a source the basemap style provides; reuse it
      // rather than duplicating something we don't own.
      return { layers: [toLayer(id, configuration, layer.visible)], sources: [] }
    }

    // Collections: one GeoJSON source, a circle per place, and a glyph on top
    // once the dot is big enough — the same two-layer treatment saved places
    // already get on the main map.
    const sourceId = scopedId(canvasId, layer.id, '-source')
    const places = collectionPlaces(layer)
    void ensureIconImages(strategy.mapInstance, savedPlaceIconSpecs(places))

    strategy.addSource(sourceId, {
      type: 'geojson',
      data: buildSavedPlacesGeoJSON(places),
    })

    return {
      layers: [
        toLayer(
          scopedId(canvasId, layer.id, '-circles'),
          { ...BOOKMARKS_CIRCLES_LAYER_CONFIG.configuration, source: sourceId },
          layer.visible,
        ),
        toLayer(
          scopedId(canvasId, layer.id, '-icons'),
          { ...BOOKMARKS_ICONS_LAYER_CONFIG.configuration, source: sourceId },
          layer.visible,
        ),
      ],
      sources: [sourceId],
    }
  }

  function render() {
    const strategy = mapStore.getMapStrategy()
    if (!strategy) return

    const nextLayers = new Set<string>()
    const nextSources = new Set<string>()

    for (const canvas of canvases.value) {
      // Bottom of the list draws first, matching how the layer library reads.
      for (const layer of canvas.body?.layers ?? []) {
        const plan = planLayer(strategy, canvas.id, layer)
        for (const mapLayer of plan.layers) {
          strategy.addLayer(mapLayer, true)
          strategy.toggleLayerVisibility(mapLayer.id, layer.visible)
          nextLayers.add(mapLayer.id)
        }
        plan.sources.forEach(id => nextSources.add(id))
      }
    }

    for (const id of mounted) {
      if (!nextLayers.has(id)) strategy.removeLayer(id)
    }
    for (const id of mountedSources) {
      if (!nextSources.has(id)) strategy.removeSource(id)
    }

    mounted = nextLayers
    mountedSources = nextSources
  }

  function teardown() {
    const strategy = mapStore.getMapStrategy()
    if (!strategy) return
    mounted.forEach(id => strategy.removeLayer(id))
    mountedSources.forEach(id => strategy.removeSource(id))
    mounted = new Set()
    mountedSources = new Set()
  }

  watch(canvases, render, { deep: true, immediate: true })

  // The basemap style change drops every layer we added, so put them back.
  mapStore.on('style.load', render)

  onScopeDispose(() => {
    mapStore.off('style.load', render)
    teardown()
  })

  return { render, teardown, key: options.key }
}
