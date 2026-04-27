import { watch, markRaw } from 'vue'
import { storeToRefs } from 'pinia'
import { useTimelineStore } from '@/stores/timeline.store'
import type { MapStrategy } from '@/components/map/map-providers/map.strategy'
import TimelineStopMarker from '@/components/map/markers/TimelineStopMarker.vue'
import {
  LayerType,
  MapboxLayerType,
  MapEngine,
  type Layer,
} from '@/types/map.types'
import {
  TRAVEL_MODE_COLORS,
  getTravelModeColor,
  getTravelModeCaseColor,
} from '@/lib/travel-mode-colors'
import type {
  LocationHistoryEntry,
  LocationHistorySegment,
  LocationHistoryStop,
} from '@server/types/location-history.types'

const STOP_PREFIX = 'timeline-stop-'
const PATHS_SOURCE = 'timeline-paths'
const PATHS_CASE_LAYER_ID = 'timeline-paths-case'
const PATHS_LAYER_ID = 'timeline-paths-line'

const EMPTY_FC = {
  type: 'FeatureCollection' as const,
  features: [] as any[],
}

function pathsBaseLayer(
  id: string,
  paint: Record<string, unknown>,
  order: number,
): Layer {
  return {
    id,
    name: id,
    type: LayerType.CUSTOM,
    engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
    showInLayerSelector: false,
    visible: true,
    icon: null,
    order,
    groupId: null,
    userId: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    configuration: {
      id,
      type: MapboxLayerType.LINE,
      source: PATHS_SOURCE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint,
    },
  }
}

/**
 * Build a Mapbox `match` expression from `TRAVEL_MODE_COLORS` so a single
 * line layer can colour each feature by its `mode` property — matching the
 * per-mode tint the directions/trips overlay uses for routes.
 */
function modeColorExpression(kind: 'main' | 'case'): any[] {
  const fallback =
    kind === 'main'
      ? getTravelModeColor('unknown')
      : getTravelModeCaseColor('unknown')
  const expr: any[] = ['match', ['get', 'mode']]
  for (const [mode, palette] of Object.entries(TRAVEL_MODE_COLORS)) {
    expr.push(mode, palette[kind])
  }
  expr.push(fallback)
  return expr
}

type FitBoundsFn = (
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  options?: any,
) => void

/**
 * Renders the active timeline on the map: numbered stop markers and per-segment
 * polylines coloured with the primary tint. The layer mirrors
 * `timelineStore.entries` — when entries clear (route change, integration
 * disconnect), markers and the paths source are removed.
 *
 * `fitBounds` should be the obstruction-aware wrapper from `mapService.fitBounds`
 * (not the raw `mapStrategy.fitBounds`) so the route is framed inside the
 * visible-map-area instead of behind the LeftSheet drawer.
 */
export function useTimelineLayerService() {
  let initialized = false
  let watcherStop: (() => void) | null = null

  function initializeTimelineLayer(
    mapStrategy: MapStrategy,
    fitBounds: FitBoundsFn,
  ) {
    if (!mapStrategy || initialized) return
    initialized = true

    const timelineStore = useTimelineStore()
    const { entries } = storeToRefs(timelineStore)

    function clearMarkers() {
      mapStrategy.removeMarkersByPrefix(STOP_PREFIX)
    }

    function clearPaths() {
      try {
        mapStrategy.removeLayer(PATHS_LAYER_ID)
        mapStrategy.removeLayer(PATHS_CASE_LAYER_ID)
        mapStrategy.removeSource(PATHS_SOURCE)
      } catch {
        // Idempotent — fine if any of these don't exist yet.
      }
    }

    function ensurePathsScaffolding() {
      try {
        mapStrategy.addSource(PATHS_SOURCE, {
          type: 'geojson',
          data: EMPTY_FC,
        })
      } catch {
        // Source may already exist (style change re-init). Ignore.
      }

      // Match the directions/trips overlay: per-mode case + main lines, both
      // coloured via the shared TRAVEL_MODE_COLORS palette.
      mapStrategy.addLayer(
        pathsBaseLayer(
          PATHS_CASE_LAYER_ID,
          {
            'line-color': modeColorExpression('case'),
            'line-width': 8,
            'line-opacity': 1,
            'line-emissive-strength': 1,
          },
          9990,
        ),
      )

      mapStrategy.addLayer(
        pathsBaseLayer(
          PATHS_LAYER_ID,
          {
            'line-color': modeColorExpression('main'),
            'line-width': 6,
            'line-opacity': 1,
            'line-emissive-strength': 1,
          },
          9991,
        ),
      )
    }

    function setPaths(segments: LocationHistorySegment[]) {
      const fc = {
        type: 'FeatureCollection' as const,
        features: segments
          .filter((s) => s.geometry.length >= 2)
          .map((seg) => ({
            type: 'Feature' as const,
            properties: { mode: seg.mode },
            geometry: {
              type: 'LineString' as const,
              coordinates: seg.geometry.map((c) => [c.lng, c.lat]),
            },
          })),
      }

      const source: any = mapStrategy.mapInstance?.getSource(PATHS_SOURCE)
      if (source?.setData) {
        source.setData(fc)
      } else {
        // Source doesn't exist yet — recreate scaffolding then set.
        ensurePathsScaffolding()
        const after: any = mapStrategy.mapInstance?.getSource(PATHS_SOURCE)
        after?.setData?.(fc)
      }
    }

    function render(list: LocationHistoryEntry[]) {
      clearMarkers()

      if (list.length === 0) {
        setPaths([])
        return
      }

      // Number markers by stops-only sequence so "1, 2, 3" matches the
      // human reading "first place, second place, third place".
      const stops = list.filter(
        (e): e is LocationHistoryStop => e.type === 'stop',
      )
      stops.forEach((stop, i) => {
        mapStrategy.addVueMarker(
          `${STOP_PREFIX}${stop.id}`,
          { lng: stop.coordinate.lng, lat: stop.coordinate.lat },
          markRaw(TimelineStopMarker),
          { index: i },
          2,
        )
      })

      const segments = list.filter(
        (e): e is LocationHistorySegment => e.type === 'segment',
      )
      setPaths(segments)
    }

    function fitToEntries(list: LocationHistoryEntry[]) {
      if (list.length === 0) return
      let minLat = Infinity
      let maxLat = -Infinity
      let minLng = Infinity
      let maxLng = -Infinity

      for (const e of list) {
        if (e.type === 'stop') {
          minLat = Math.min(minLat, e.coordinate.lat)
          maxLat = Math.max(maxLat, e.coordinate.lat)
          minLng = Math.min(minLng, e.coordinate.lng)
          maxLng = Math.max(maxLng, e.coordinate.lng)
        } else {
          for (const c of e.geometry) {
            minLat = Math.min(minLat, c.lat)
            maxLat = Math.max(maxLat, c.lat)
            minLng = Math.min(minLng, c.lng)
            maxLng = Math.max(maxLng, c.lng)
          }
        }
      }

      if (!Number.isFinite(minLat)) return
      // Use the obstruction-aware wrapper so the route is framed inside the
      // visible map area (i.e. NOT under the left sheet) and a re-fit fires
      // once the drawer settles if it's still animating.
      fitBounds(
        { minLat, minLng, maxLat, maxLng },
        { padding: 40, maxZoom: 15 },
      )
    }

    ensurePathsScaffolding()

    // `immediate: true` covers both the "data already loaded" case (e.g. the
    // map mounted after the timeline page) and every subsequent update.
    watcherStop = watch(
      entries,
      (next) => {
        render(next)
        // Re-fit the camera to the route on every data update — same as the
        // directions view, where each new trip recomputes the framing.
        if (next.length > 0) fitToEntries(next)
      },
      { flush: 'post', immediate: true },
    )
  }

  function destroyTimelineLayer(mapStrategy?: MapStrategy) {
    watcherStop?.()
    watcherStop = null
    initialized = false
    if (!mapStrategy) return
    mapStrategy.removeMarkersByPrefix(STOP_PREFIX)
    try {
      mapStrategy.removeLayer(PATHS_LAYER_ID)
      mapStrategy.removeLayer(PATHS_CASE_LAYER_ID)
      mapStrategy.removeSource(PATHS_SOURCE)
    } catch {
      // ignore
    }
  }

  return { initializeTimelineLayer, destroyTimelineLayer }
}
