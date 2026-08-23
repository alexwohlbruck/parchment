/**
 * Draws canvases on the map.
 *
 * Used twice, with the same code: the map draws every canvas the user has
 * switched on, and the canvas editor draws the one being edited (its working
 * copy, so reordering and toggling read immediately). Both hand over a list;
 * this reconciles it against what is currently on the map.
 *
 * Every id is namespaced by the *instance key* and then the canvas, because
 * two renderers are routinely alive at once: the main map draws the canvases
 * you have switched on, while the editor draws the working copy of the one
 * you have open. Sharing ids between them meant each instance's bookkeeping
 * described layers the other had already replaced, and the engine ended up
 * asked to drop a source a live layer was still using.
 *
 * Sources are added by hand rather than inlined into `addLayer`: the engine
 * refuses to drop a source a layer still uses, so re-adding one every render
 * pass both failed and refetched every tile. Both sources and layers are
 * cached against what is already on the map, and a pass only touches what
 * genuinely changed — a reorder moves layers, a visibility toggle flips one
 * flag, and new GeoJSON goes straight into the live source. This is what
 * keeps editing responsive: rebuilding a source drops every layer drawn from
 * it, so a render pass that rebuilds everything is one the user can feel.
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
import { resolveSpecBounds } from '@/lib/map-style/bounds'
import { annotationsCollection } from '@/lib/canvas-annotations'
import { presetLayers } from '@/lib/map-style/data-presets'
import { useRoutesStore } from '@/stores/library/routes.store'
import { useFriendLocationFeatures } from '@/composables/useFriendLocationFeatures'
import { themeColorToHex } from '@/lib/utils'
import {
  BOOKMARKS_CIRCLES_LAYER_CONFIG,
  BOOKMARKS_ICONS_LAYER_CONFIG,
} from '@/constants/layers'

export interface RenderableCanvas {
  id: string
  body: CanvasBody
  /** Id of the annotation currently selected, drawn with a halo. */
  selectedAnnotationId?: string | null
  /**
   * A mark the overlay is drawing instead — one being reshaped. Held out of
   * the style so it isn't painted twice, slightly out of step with itself.
   */
  suppressedAnnotationId?: string | null
}

/**
 * `canvas-<key>-<canvasId>-<layerId>`, with a suffix for multi-layer kinds.
 * The key is what keeps two live renderers off each other's layers.
 */
function scopedId(
  key: string,
  canvasId: string,
  layerId: string,
  suffix = '',
) {
  return `canvas-${key}-${canvasId}-${layerId}${suffix}`
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
  const routesStore = useRoutesStore()
  const { peopleFeatures } = useFriendLocationFeatures()
  const bookmarksStore = useBookmarksStore()
  const pointsStore = useEncryptedPointsStore()
  const { layers: libraryLayers } = storeToRefs(layersStore)

  /** Layer id → the configuration on the map, so an unchanged layer is left alone. */
  let mountedLayers = new Map<string, string>()
  /** Source id → the spec currently on the map, so we only rebuild on change. */
  let mountedSources = new Map<string, string>()

  function collectionPlaces(layer: Extract<CanvasLayer, { kind: 'collection' }>) {
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

  interface LayerPlan {
    /** Style-spec sources this layer needs, keyed by the id they go in under. */
    sources: Record<string, Record<string, unknown>>
    /** Map layers, each already pointing at a source id rather than a spec. */
    layers: Layer[]
  }

  const EMPTY_PLAN: LayerPlan = { sources: {}, layers: [] }

  /**
   * What one canvas layer resolves to. Pure apart from registering sprite
   * images, which have to be on the map before a symbol layer referencing
   * them is added.
   */
  function planLayer(
    strategy: MapStrategy,
    canvasId: string,
    layer: CanvasLayer,
  ): LayerPlan {
    const layerId = scopedId(options.key, canvasId, layer.id)
    const sourceId = scopedId(options.key, canvasId, layer.id, '-source')

    if (layer.kind === 'style' || layer.kind === 'library') {
      const configuration =
        layer.kind === 'style'
          ? ({ ...layer.configuration } as Record<string, unknown>)
          : (() => {
              const source = libraryLayers.value.find(
                l => l.id === layer.layerId,
              )
              // A borrowed layer that no longer exists, or one drawn as Vue
              // markers rather than a style layer (friends, trackers, notes),
              // has nothing to copy onto the canvas.
              if (!source || MARKER_RENDERED_LAYER_TYPES.has(source.type)) {
                return null
              }
              return { ...source.configuration } as Record<string, unknown>
            })()

      if (!configuration) return EMPTY_PLAN

      const spec = configuration.source
      if (spec && typeof spec === 'object') {
        const { id: _id, ...options } = spec as Record<string, unknown>
        return {
          sources: { [sourceId]: options },
          layers: [toLayer(layerId, { ...configuration, source: sourceId }, layer.visible)],
        }
      }
      // The layer names a source the basemap style provides; reuse it rather
      // than duplicating something we don't own.
      return { sources: {}, layers: [toLayer(layerId, configuration, layer.visible)] }
    }

    if (layer.kind === 'data') {
      // One source, however many layers the render mode needs. A remote
      // dataset is handed to the engine as a URL so the canvas never carries
      // its bytes.
      return {
        sources: {
          [sourceId]: { type: 'geojson', data: layer.url ?? layer.data },
        },
        layers: presetLayers(layer.render, sourceId, layer.style).map(preset =>
          toLayer(
            scopedId(options.key, canvasId, layer.id, preset.suffix),
            preset.configuration,
            layer.visible,
          ),
        ),
      }
    }

    if (layer.kind === 'route') {
      const route = routesStore.getRouteById(layer.routeId)
      const geometry = route?.body?.geometry
      // A route whose body hasn't decrypted on this device yet has nothing to
      // draw; it comes back on its own once the seed lands.
      if (!geometry?.length) return EMPTY_PLAN
      const color = layer.color ?? '#2563eb'
      return {
        sources: {
          [sourceId]: {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: geometry },
              properties: {},
            },
          },
        },
        layers: [
          toLayer(
            scopedId(options.key, canvasId, layer.id, '-case'),
            {
              type: 'line',
              source: sourceId,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.8 },
            },
            layer.visible,
          ),
          toLayer(
            scopedId(options.key, canvasId, layer.id, '-line'),
            {
              type: 'line',
              source: sourceId,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: { 'line-color': color, 'line-width': 4 },
            },
            layer.visible,
          ),
        ],
      }
    }

    if (layer.kind === 'people') {
      const features = peopleFeatures(layer.friendHandles)
      if (!features.features.length) return EMPTY_PLAN
      return {
        sources: { [sourceId]: { type: 'geojson', data: features } },
        layers: [
          toLayer(
            scopedId(options.key, canvasId, layer.id, '-halo'),
            {
              type: 'circle',
              source: sourceId,
              paint: {
                'circle-color': ['get', 'color'],
                'circle-radius': 11,
                'circle-opacity': 0.25,
              },
            },
            layer.visible,
          ),
          toLayer(
            scopedId(options.key, canvasId, layer.id, '-dot'),
            {
              type: 'circle',
              source: sourceId,
              paint: {
                'circle-color': ['get', 'color'],
                'circle-radius': 6,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
              },
            },
            layer.visible,
          ),
          toLayer(
            scopedId(options.key, canvasId, layer.id, '-label'),
            {
              type: 'symbol',
              source: sourceId,
              layout: {
                'text-field': ['get', 'name'],
                'text-size': 12,
                'text-anchor': 'top',
                'text-offset': [0, 1],
                'text-optional': true,
              },
              paint: {
                'text-color': '#111827',
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.2,
              },
            },
            layer.visible,
          ),
        ],
      }
    }

    // Collections: one GeoJSON source, a circle per place, and a glyph on top
    // once the dot is big enough — the same two-layer treatment saved places
    // already get on the main map.
    const places = collectionPlaces(layer)
    void ensureIconImages(strategy.mapInstance, savedPlaceIconSpecs(places))

    return {
      sources: {
        [sourceId]: { type: 'geojson', data: buildSavedPlacesGeoJSON(places) },
      },
      layers: [
        toLayer(
          scopedId(options.key, canvasId, layer.id, '-circles'),
          { ...BOOKMARKS_CIRCLES_LAYER_CONFIG.configuration, source: sourceId },
          layer.visible,
        ),
        toLayer(
          scopedId(options.key, canvasId, layer.id, '-icons'),
          { ...BOOKMARKS_ICONS_LAYER_CONFIG.configuration, source: sourceId },
          layer.visible,
        ),
      ],
    }
  }

  /**
   * Annotations draw as one bucket per canvas — a fill, its outline, a dot for
   * pins and a label — rather than a layer each. They are always added last,
   * so marks you made sit above the data you brought.
   *
   * Committed marks only. Whatever is being drawn right now is painted on the
   * overlay canvas instead, so the pointer never drives a style change.
   */
  function planAnnotations(canvas: RenderableCanvas): LayerPlan {
    const annotations = (canvas.body?.annotations ?? []).filter(
      annotation => annotation.id !== canvas.suppressedAnnotationId,
    )
    if (!annotations.length) return EMPTY_PLAN

    const sourceId = scopedId(options.key, canvas.id, 'annotations', '-source')
    const id = (suffix: string) =>
      scopedId(options.key, canvas.id, 'annotations', suffix)

    return {
      sources: {
        [sourceId]: {
          type: 'geojson',
          data: annotationsCollection(
            annotations,
            canvas.selectedAnnotationId ?? null,
            themeColorToHex,
          ),
        },
      },
      layers: [
        toLayer(
          id('-fill'),
          {
            type: 'fill',
            source: sourceId,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 },
          },
          true,
        ),
        toLayer(
          id('-stroke'),
          {
            type: 'line',
            source: sourceId,
            filter: ['!=', ['geometry-type'], 'Point'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 3 },
          },
          true,
        ),
        // A halo under the selected annotation, so clicking one shows.
        toLayer(
          id('-selected'),
          {
            type: 'circle',
            source: sourceId,
            filter: [
              'all',
              ['==', ['geometry-type'], 'Point'],
              ['to-boolean', ['get', 'selected']],
            ],
            paint: {
              'circle-color': ['get', 'color'],
              'circle-radius': 14,
              'circle-opacity': 0.25,
            },
          },
          true,
        ),
        toLayer(
          id('-pins'),
          {
            type: 'circle',
            source: sourceId,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-color': ['get', 'color'],
              'circle-radius': 7,
              'circle-stroke-width': 2.5,
              'circle-stroke-color': '#ffffff',
            },
          },
          true,
        ),
        toLayer(
          id('-labels'),
          {
            type: 'symbol',
            source: sourceId,
            filter: ['!=', ['get', 'label'], ''],
            layout: {
              'text-field': ['get', 'label'],
              'text-size': 12,
              // A label above the mark anchors by its own bottom edge, and so
              // on round — the anchor is the opposite of where the text goes.
              'text-anchor': [
                'match',
                ['get', 'labelPosition'],
                'top',
                'bottom',
                'bottom',
                'top',
                'left',
                'right',
                'right',
                'left',
                'center',
              ],
              'text-offset': [
                'match',
                ['get', 'labelPosition'],
                'top',
                ['literal', [0, -1.1]],
                'bottom',
                ['literal', [0, 1.1]],
                'left',
                ['literal', [-1.1, 0]],
                'right',
                ['literal', [1.1, 0]],
                ['literal', [0, 0]],
              ],
              'text-optional': true,
            },
            paint: {
              'text-color': '#111827',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.2,
            },
          },
          true,
        ),
      ],
    }
  }

  /**
   * The data of a GeoJSON source whose spec changed in no other way, or
   * undefined if the source has to be rebuilt.
   *
   * Worth telling apart: rebuilding a source means dropping every layer drawn
   * from it and adding them all back. That is slow, and it is visible — the
   * annotation bucket would flash on every mark committed.
   */
  function inlineDataChange(
    previousSpec: string,
    spec: Record<string, unknown>,
  ): unknown | undefined {
    if (spec.type !== 'geojson' || spec.data === undefined) return undefined
    let previous: Record<string, unknown>
    try {
      previous = JSON.parse(previousSpec)
    } catch {
      return undefined
    }
    if (previous.type !== 'geojson') return undefined

    const withoutData = (source: Record<string, unknown>) =>
      JSON.stringify(
        Object.keys(source)
          .filter(key => key !== 'data')
          .sort()
          .map(key => [key, source[key]]),
      )
    return withoutData(previous) === withoutData(spec) ? spec.data : undefined
  }

  function render() {
    const strategy = mapStore.getMapStrategy()
    if (!strategy) return

    /** Source id → its serialised spec, and the spec itself to hand over. */
    const nextSources = new Map<string, string>()
    const specs = new Map<string, Record<string, unknown>>()
    /** Layer id → serialised configuration, the key for "has this changed". */
    const nextLayers = new Map<string, string>()
    const plans: { plan: LayerPlan; visible: boolean }[] = []

    function collect(plan: LayerPlan, visible: boolean) {
      plans.push({ plan, visible })
      for (const [id, spec] of Object.entries(plan.sources)) {
        nextSources.set(id, JSON.stringify(spec))
        specs.set(id, spec)
      }
      for (const layer of plan.layers) {
        nextLayers.set(layer.id, JSON.stringify([layer.configuration, visible]))
      }
    }

    for (const canvas of canvases.value) {
      // Bottom of the list draws first, matching how the layer library reads.
      for (const layer of canvas.body?.layers ?? []) {
        collect(planLayer(strategy, canvas.id, layer), layer.visible)
      }
      // Annotations last, so they draw over the canvas's own layers.
      const annotations = planAnnotations(canvas)
      if (annotations.layers.length) collect(annotations, true)
    }

    /**
     * Changed sources, split by what the change costs: data a live source can
     * take in place, and everything else, which has to come down and go back
     * up with every layer drawn from it.
     */
    const updating = new Map<string, unknown>()
    const rebuilding = new Set<string>()
    for (const [id, spec] of nextSources) {
      const previous = mountedSources.get(id)
      if (previous === spec) continue
      const data =
        previous === undefined
          ? undefined
          : inlineDataChange(previous, specs.get(id)!)
      if (data === undefined) rebuilding.add(id)
      else updating.set(id, data)
    }

    const onRebuiltSource = new Set(
      plans
        .filter(({ plan }) =>
          Object.keys(plan.sources).some(id => rebuilding.has(id)),
        )
        .flatMap(({ plan }) => plan.layers.map(layer => layer.id)),
    )

    // Nothing may reference a source we are about to drop — the engine
    // refuses outright, and the failed drop used to leave the next addSource
    // colliding with the source it thought it had removed. So layers come off
    // first: the ones going away, and the ones sitting on a rebuilt source.
    for (const id of [...mountedLayers.keys()]) {
      if (!nextLayers.has(id) || onRebuiltSource.has(id)) {
        strategy.removeLayer(id)
        mountedLayers.delete(id)
      }
    }

    for (const id of mountedSources.keys()) {
      if (!nextSources.has(id) || rebuilding.has(id)) strategy.removeSource(id)
    }

    for (const [id, data] of updating) strategy.setSourceData(id, data)

    for (const { plan, visible } of plans) {
      for (const [id, spec] of Object.entries(plan.sources)) {
        if (rebuilding.has(id)) strategy.addSource(id, spec)
      }
      for (const mapLayer of plan.layers) {
        // Re-adding an unchanged layer rebuilds the style for nothing, and
        // this used to run for every layer on every pass — which is why
        // moving the pointer rebuilt the whole canvas, sixty times a second.
        if (mountedLayers.get(mapLayer.id) === nextLayers.get(mapLayer.id)) {
          continue
        }
        strategy.addLayer(mapLayer, true)
        strategy.toggleLayerVisibility(mapLayer.id, visible)
      }
    }

    mountedLayers = nextLayers
    mountedSources = nextSources
  }

  function teardown() {
    const strategy = mapStore.getMapStrategy()
    if (!strategy) return
    mountedLayers.forEach((_configuration, id) => strategy.removeLayer(id))
    mountedSources.forEach((_spec, id) => strategy.removeSource(id))
    mountedLayers = new Map()
    mountedSources = new Map()
  }

  watch(canvases, render, { deep: true, immediate: true })

  // The basemap style change drops every layer we added, so put them back.
  mapStore.on('style.load', render)

  /**
   * Fly to a canvas layer's data.
   *
   * Called when a layer is first added: whatever you just picked is rarely
   * under the current view, and an overlay you can't see reads as one that
   * didn't work. A layer whose extent can't be determined — bare tile
   * templates, an empty collection — leaves the camera alone.
   */
  async function fitToLayer(canvasId: string, layer: CanvasLayer) {
    const strategy = mapStore.getMapStrategy()
    if (!strategy) return

    const plan = planLayer(strategy, canvasId, layer)
    const specs = Object.values(plan.sources)
    if (!specs.length) return

    const bounds = await resolveSpecBounds(specs[0])
    if (!bounds) return
    strategy.fitBounds(bounds, { padding: 80, duration: 900 })
  }

  onScopeDispose(() => {
    mapStore.off('style.load', render)
    teardown()
  })

  return { render, teardown, fitToLayer, key: options.key }
}
