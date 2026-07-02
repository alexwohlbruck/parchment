/**
 * Transit Layers Service
 *
 * Handles transit-specific layer operations including bulk visibility toggles
 * and the transit line/stop hover + click interactions (route and stop detail
 * click-through with disambiguation).
 */

import type { Layer } from '@/types/map.types'
import { LayerType, MapColorTheme } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { useThemeStore } from '@/stores/theme.store'
import { mapEventBus } from '@/lib/eventBus'
import { styleConfigs } from '@/lib/basemap-style-config'
import {
  getTransitHitMinZoom,
  isTransitLineHitLayer,
  isTransitStopHitLayer,
} from '@/lib/transit.utils'
import { collectRouteCandidates } from '@/lib/transit-route-candidates'
import { collectStopCandidates } from '@/lib/transit-stop-candidates'

// ── Transit line hover / click interactions ────────────────────────────────
//
// Map-level wiring (one listener set per map instance, all transit route
// layers at once) rather than per-layer delegates: each engine-side delegate
// (`map.on('mousemove', layerId, …)`) runs its own queryRenderedFeatures per
// mousemove per layer — with 7+ transit line layers that is a query storm.
// Here mousemoves only stash the cursor position; a single rAF-throttled
// query (small bbox, hit layers only) resolves hover, and clicks do one
// query at a slightly larger radius.

/** Maps that already have the line interaction listeners attached.
 *  (initializeLayers re-runs on every style.load; the map instance persists
 *  across style swaps, so listeners must be registered exactly once.) */
const lineInteractionsAttached = new WeakSet<object>()

/** Hit-test slop around the cursor, in screen px. */
const HOVER_RADIUS_PX = 3
const CLICK_RADIUS_PX = 6

/** Layer ids owned by other click-through handlers — basemap POIs (self-hosted
 *  styles) and street imagery dots. Both navigate on click, so the transit
 *  line click yields whenever one of them sits under the cursor. */
const PRIORITY_CLICK_LAYER_IDS: string[] = [
  ...new Set(Object.values(styleConfigs).flatMap(c => c.poiLayerIds)),
  'mapillary-image',
]

interface FeatureStateTarget {
  source: string
  sourceLayer?: string
  id: string | number
}

export function useTransitLayersService() {
  const themeStore = useThemeStore()

  // ============================================================================
  // TRANSIT LINE HOVER + CLICK (route detail click-through)
  // ============================================================================

  /**
   * Wire hover (pointer cursor + feature-state highlight) and click (route /
   * stop detail navigation with disambiguation) for every transit route line
   * and stop layer. Layers are discovered by `metadata.transitRole` from the
   * live style, so the wiring survives layer additions/removals and style
   * swaps.
   *
   * Idempotent per map instance — safe to call from every initializeLayers
   * pass. Identical engine API surface on Mapbox GL and MapLibre
   * (queryRenderedFeatures / setFeatureState / removeFeatureState).
   */
  function addTransitLineInteractions(mapStrategy: MapStrategy) {
    const map = mapStrategy?.mapInstance
    if (!map || lineInteractionsAttached.has(map)) return
    lineInteractionsAttached.add(map)

    // ── Hit-layer cache: recomputed lazily after style mutations ──
    // Each hit layer carries its `metadata.hitMinZoom` gate: layers that fade
    // in on an opacity ramp (buses are fully transparent when zoomed out) are
    // still reported by queryRenderedFeatures, so hit testing skips them
    // until they are actually visible.
    let lineHitLayers: Array<{ id: string; minZoom: number }> = []
    let stopHitLayers: Array<{ id: string; minZoom: number }> = []
    let layersDirty = true
    map.on('styledata', () => {
      layersDirty = true
    })

    function refreshLayerCaches() {
      let styleLayers: any[] = []
      try {
        styleLayers = map.getStyle()?.layers ?? []
      } catch {
        styleLayers = []
      }
      lineHitLayers = styleLayers
        .filter((layer: any) => isTransitLineHitLayer(layer))
        .map((layer: any) => ({
          id: layer.id,
          minZoom: getTransitHitMinZoom(layer),
        }))
      stopHitLayers = styleLayers
        .filter((layer: any) => isTransitStopHitLayer(layer))
        .map((layer: any) => ({
          id: layer.id,
          minZoom: getTransitHitMinZoom(layer),
        }))
      layersDirty = false
    }

    function queryHitLayers(
      hitLayers: Array<{ id: string; minZoom: number }>,
      point: { x: number; y: number },
      radius: number,
    ): any[] {
      if (hitLayers.length === 0) return []
      // Defensive: drop ids the style lost since the cache refresh — Mapbox
      // GL throws on unknown layer ids in queryRenderedFeatures.
      const zoom = map.getZoom()
      const layers = hitLayers
        .filter(layer => zoom >= layer.minZoom && map.getLayer(layer.id))
        .map(layer => layer.id)
      if (layers.length === 0) return []
      const bbox: [[number, number], [number, number]] = [
        [point.x - radius, point.y - radius],
        [point.x + radius, point.y + radius],
      ]
      try {
        return map.queryRenderedFeatures(bbox, { layers }) ?? []
      } catch {
        return []
      }
    }

    // Refresh BEFORE reading the cache variable — refreshLayerCaches
    // reassigns it, so passing a stale reference would query dropped layers.
    function queryTransitLines(
      point: { x: number; y: number },
      radius: number,
    ): any[] {
      if (layersDirty) refreshLayerCaches()
      return queryHitLayers(lineHitLayers, point, radius)
    }

    function queryTransitStops(
      point: { x: number; y: number },
      radius: number,
    ): any[] {
      if (layersDirty) refreshLayerCaches()
      return queryHitLayers(stopHitLayers, point, radius)
    }

    /** True when a feature owned by another click-through handler (basemap
     *  POI, street imagery dot) sits under the point — that handler's
     *  navigation wins over the transit line underneath. */
    function hitsPriorityLayer(point: { x: number; y: number }): boolean {
      const layers = PRIORITY_CLICK_LAYER_IDS.filter(id => map.getLayer(id))
      if (layers.length === 0) return false
      try {
        return (map.queryRenderedFeatures(point, { layers }) ?? []).length > 0
      } catch {
        return false
      }
    }

    // ── Hover: feature-state highlight + pointer cursor ──
    // The non-bundled rail hover rides the dedicated `transit-routes-hover`
    // halo layer (feature-state opacity); the bundled ribbons carry a
    // feature-state width bump in their steady/transition templates.
    let hovered: FeatureStateTarget | null = null
    let cursorSet = false

    function setHovered(next: FeatureStateTarget | null) {
      if (
        hovered &&
        next &&
        hovered.id === next.id &&
        hovered.source === next.source &&
        hovered.sourceLayer === next.sourceLayer
      ) {
        return
      }
      try {
        if (hovered) map.removeFeatureState(hovered, 'hover')
        if (next) map.setFeatureState(next, { hover: true })
      } catch {
        // Source may be mid-reload during a style swap.
      }
      hovered = next

      const canvas = map.getCanvas()
      if (next && !cursorSet) {
        canvas.style.cursor = 'pointer'
        cursorSet = true
      } else if (!next && cursorSet) {
        // Only clear a cursor we set (POI hover shares this canvas).
        if (canvas.style.cursor === 'pointer') canvas.style.cursor = ''
        cursorSet = false
      }
    }

    // rAF-throttled hover resolution: mousemove just stashes the point.
    let pendingPoint: { x: number; y: number } | null = null
    let hoverFrame: number | null = null

    function resolveHover() {
      hoverFrame = null
      const point = pendingPoint
      pendingPoint = null
      if (!point) return
      const feature = queryTransitLines(point, HOVER_RADIUS_PX).find(
        (f: any) => f?.id !== undefined && f?.id !== null && f?.source,
      )
      setHovered(
        feature
          ? {
              source: feature.source,
              sourceLayer: feature.sourceLayer,
              id: feature.id,
            }
          : null,
      )
    }

    map.on('mousemove', (e: any) => {
      // Skip hover work while the camera is animating/dragging.
      if (map.isMoving?.()) return
      pendingPoint = e.point
      if (hoverFrame === null) {
        hoverFrame = requestAnimationFrame(resolveHover)
      }
    })
    map.on('mouseout', () => {
      pendingPoint = null
      setHovered(null)
    })

    // ── Click: collect candidates → navigate or disambiguate ──
    map.on('click', (e: any) => {
      // DOM overlays (search pins, station/tracker markers) sit above the
      // canvas and run their own click handlers; their clicks bubble through
      // to the map, so only bare canvas clicks count here.
      const target = e.originalEvent?.target
      if (target && target !== map.getCanvas()) return
      // Yield to feature layers with their own click-through navigation.
      if (hitsPriorityLayer(e.point)) return
      // Stops (point targets, proprietary stop-detail destination) and route
      // lines are collected together; the popover component navigates when
      // exactly one candidate remains, else disambiguates.
      const stops = collectStopCandidates(
        queryTransitStops(e.point, CLICK_RADIUS_PX),
      )
      const candidates = collectRouteCandidates(
        queryTransitLines(e.point, CLICK_RADIUS_PX),
      )
      if (stops.length === 0 && candidates.length === 0) return

      // Anchor in viewport coordinates (e.point is map-container-relative).
      let x = e.point.x
      let y = e.point.y
      try {
        const rect = map.getContainer().getBoundingClientRect()
        x += rect.left
        y += rect.top
      } catch {
        // Container not measurable — popover falls back to container coords.
      }

      mapEventBus.emit('click:transit-line', {
        lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
        point: { x, y },
        candidates,
        stops,
      })
    })
  }

  // ============================================================================
  // BULK VISIBILITY OPERATIONS
  // ============================================================================

  /**
   * Toggle visibility for all transit layers
   *
   * Also updates the visibility of any parent groups so that the layer
   * selector UI (which reads `group.visible`) stays in sync when transit
   * layers are toggled externally.
   */
  async function toggleTransitLayers(
    layers: Layer[],
    layersStore: any,
    mapStrategy?: MapStrategy,
    visible?: boolean,
  ) {
    const newState = visible ?? false

    const transitLayers = layers.filter(
      layer => layer.type === LayerType.TRANSIT,
    )

    const affectedGroupIds = new Set<string>()

    for (const layer of transitLayers) {
      // Visibility is ephemeral UI state — always route through the store's
      // local override map (localStorage-backed) rather than the server CRUD
      // path. This keeps toggles cheap and cross-device sync is intentionally
      // not a goal for visibility.
      layersStore.updateLayerVisibility(layer.id, newState)

      if (layer.groupId) {
        affectedGroupIds.add(layer.groupId)
      }

      if (mapStrategy) {
        mapStrategy.toggleLayerVisibility(layer.configuration.id, newState)
      }
    }

    // Keep parent groups in sync so the layer selector reflects the change.
    for (const groupId of affectedGroupIds) {
      layersStore.toggleLayerGroupVisibility(groupId, newState)
    }

    // Apply basemap fade and transit label visibility
    if (mapStrategy) {
      const shouldUseFaded = newState && !themeStore.isDark
      mapStrategy.setMapColorTheme(
        shouldUseFaded ? MapColorTheme.FADED : MapColorTheme.DEFAULT,
      )
      mapStrategy.setTransitLabels(!newState)
    }
  }

  return {
    addTransitLineInteractions,
    toggleTransitLayers,
  }
}
