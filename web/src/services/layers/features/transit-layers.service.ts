/**
 * Transit Layers Service
 *
 * Handles transit-specific layer operations including bulk visibility toggles,
 * transit stop click handlers for navigation, and the transit line hover /
 * click interactions (route detail click-through with disambiguation).
 */

import type { Layer } from '@/types/map.types'
import { LayerType, MapColorTheme } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useThemeStore } from '@/stores/theme.store'
import { mapEventBus } from '@/lib/eventBus'
import { isTransitLineHitLayer, isTransitStopLayer } from '@/lib/transit.utils'
import { collectRouteCandidates } from '@/lib/transit-route-candidates'

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

interface FeatureStateTarget {
  source: string
  sourceLayer?: string
  id: string | number
}

export function useTransitLayersService() {
  const router = useRouter()
  const themeStore = useThemeStore()

  // ============================================================================
  // TRANSIT STOP CLICK HANDLERS
  // ============================================================================

  /**
   * Add click handlers for transit stops to open place detail view
   */
  function addTransitStopClickHandlers(
    mapStrategy: MapStrategy,
    layerId: string,
  ) {
    if (!mapStrategy?.mapInstance) return

    const handleClick = (event: any) => {
      const feature = event.features?.[0]
      if (feature && feature.properties) {
        const onestopId =
          feature.properties.onestop_id || feature.properties.stop_id
        if (onestopId) {
          router.push({
            name: AppRoute.PLACE_PROVIDER,
            params: {
              provider: 'transitland',
              placeId: onestopId,
            },
          })
        }
      }
    }

    const handleMouseEnter = () => {
      mapStrategy.mapInstance.getCanvas().style.cursor = 'pointer'
    }

    const handleMouseLeave = () => {
      mapStrategy.mapInstance.getCanvas().style.cursor = ''
    }

    // Add all handlers
    mapStrategy.mapInstance.on('click', layerId, handleClick)
    mapStrategy.mapInstance.on('mouseenter', layerId, handleMouseEnter)
    mapStrategy.mapInstance.on('mouseleave', layerId, handleMouseLeave)
  }

  // ============================================================================
  // TRANSIT LINE HOVER + CLICK (route detail click-through)
  // ============================================================================

  /**
   * Wire hover (pointer cursor + feature-state highlight) and click (route
   * detail navigation with disambiguation) for every transit route line
   * layer. Layers are discovered by `metadata.transitRole` from the live
   * style, so the wiring survives layer additions/removals and style swaps.
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
    let lineLayerIds: string[] = []
    let stopLayerIds: string[] = []
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
      lineLayerIds = styleLayers
        .filter((layer: any) => isTransitLineHitLayer(layer))
        .map((layer: any) => layer.id)
      stopLayerIds = styleLayers
        .filter((layer: any) => isTransitStopLayer(layer))
        .map((layer: any) => layer.id)
      layersDirty = false
    }

    function queryTransitLines(
      point: { x: number; y: number },
      radius: number,
    ): any[] {
      if (layersDirty) refreshLayerCaches()
      if (lineLayerIds.length === 0) return []
      // Defensive: drop ids the style lost since the cache refresh — Mapbox
      // GL throws on unknown layer ids in queryRenderedFeatures.
      const layers = lineLayerIds.filter(id => map.getLayer(id))
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

    /** True when a transit stop sits under the point — the stop click
     *  handler (place detail) wins over the co-located line geometry. */
    function hitsTransitStop(point: { x: number; y: number }): boolean {
      if (layersDirty) refreshLayerCaches()
      const layers = stopLayerIds.filter(id => map.getLayer(id))
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
      if (hitsTransitStop(e.point)) return
      const features = queryTransitLines(e.point, CLICK_RADIUS_PX)
      if (features.length === 0) return
      const candidates = collectRouteCandidates(features)
      if (candidates.length === 0) return

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
    addTransitStopClickHandlers,
    addTransitLineInteractions,
    toggleTransitLayers,
  }
}
