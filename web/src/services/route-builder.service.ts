import { ref, watch } from 'vue'
import axios from 'axios'
import { storeToRefs } from 'pinia'
import { LngLat } from 'mapbox-gl'
import { createSharedComposable } from '@vueuse/core'
import { api } from '@/lib/api'
import { useRouteBuilderStore } from '@/stores/route-builder.store'
import { useRoutesService } from '@/services/library/routes.service'
import { useDirectionsStore } from '@/stores/directions.store'
import { useGeocodingService } from '@/services/geocoding.service'
import { getSearchResultName } from '@/lib/search.utils'
import type { Place } from '@/types/place.types'
import type {
  RouteBody,
  RouteMode,
  RouteScheme,
  RouteSegment,
  RouteStats,
  RouteWaypoint,
} from '@/types/routes.types'

/** Backend selectedMode token for a builder mode. */
function backendMode(mode: RouteMode): string {
  return mode === 'cycling' ? 'biking' : mode
}

/** Delay that resolves early if the request is superseded (aborted). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    })
  })
}

/**
 * Walk a raw directions response's segment tree and collect leaf legs with
 * geometry. Multimodal candidates nest sub-segments under
 * `details.multimodalSegments`; single-mode routes are already flat.
 */
interface CollectedLeg extends RouteSegment {
  /** Per-vertex elevation (meters), aligned to `geometry`; may be sparse. */
  elevation: Array<number | undefined>
}

function collectLegs(segments: any[]): CollectedLeg[] {
  const legs: CollectedLeg[] = []
  for (const seg of segments ?? []) {
    if (seg.details?.multimodalSegments) {
      legs.push(...collectLegs(seg.details.multimodalSegments))
      continue
    }
    const points = seg.geometry ?? []
    const geometry: Array<[number, number]> = points.map(
      (c: any) => [c.lng, c.lat] as [number, number],
    )
    const elevation: Array<number | undefined> = points.map((c: any) =>
      typeof c.elevation === 'number' ? c.elevation : undefined,
    )
    legs.push({
      mode: seg.mode,
      geometry,
      distance: seg.distance ?? 0,
      duration: seg.duration ?? 0,
      elevation,
    })
  }
  return legs
}

function routeBuilderService() {
  const store = useRouteBuilderStore()
  const { waypoints, mode, isActive } = storeToRefs(store)
  const routesService = useRoutesService()
  const geocodingService = useGeocodingService()

  const abortController = ref<AbortController | null>(null)
  const lastKey = ref('')

  function routeKey(): string {
    return (
      mode.value +
      '|' +
      waypoints.value.map((w) => `${w.lat.toFixed(6)},${w.lng.toFixed(6)}`).join(';')
    )
  }

  /**
   * Snap the dropped waypoints into a routed path via the directions engine.
   * Supersedes any in-flight request so the latest edit always wins.
   */
  async function connectDots() {
    if (!isActive.value) return
    const wps = waypoints.value
    if (wps.length < 2) {
      abortController.value?.abort()
      abortController.value = null
      store.clearRouted()
      store.isRouting = false
      lastKey.value = ''
      return
    }

    const key = routeKey()
    if (key === lastKey.value) return
    lastKey.value = key

    abortController.value?.abort()
    const controller = new AbortController()
    abortController.value = controller
    store.isRouting = true
    store.routeError = null

    try {
      const request = {
        waypoints: wps.map((wp, i) => ({
          location: { lat: wp.lat, lng: wp.lng },
          type:
            i === 0 ? 'origin' : i === wps.length - 1 ? 'destination' : 'via',
          label: wp.name ?? '',
        })),
        selectedMode: backendMode(mode.value),
        availableVehicles: [],
        routingPreferences: {},
        requestId: `builder-${Date.now()}`,
      }

      // The routing engine intermittently returns zero candidates for a
      // perfectly valid OD pair. Retry a few times before giving up so a
      // transient miss doesn't read as "no route" (and, below, never wipes
      // the user's existing path).
      let trip: any = null
      for (let attempt = 0; attempt < 4 && !trip; attempt++) {
        if (controller.signal.aborted) return
        if (attempt > 0) await sleep(250, controller.signal)
        const { data } = await api.post('/directions/', request, {
          signal: controller.signal,
          timeout: 30_000,
        })
        trip = data.trips?.[0]?.trip ?? null
      }

      if (!trip) {
        // Keep the last good geometry — a transient engine miss shouldn't
        // erase the route the user just built. Surface a soft error only.
        store.routeError = 'Couldn’t update the route — try nudging a point'
        return
      }

      const legs = collectLegs(trip.segments)
      const geometry: Array<[number, number]> = legs.flatMap((l) => l.geometry)
      // Flatten elevation aligned to geometry; keep only if any value exists.
      const elevationFlat = legs.flatMap((l) => l.elevation)
      const hasElevation = elevationFlat.some((e) => e !== undefined)
      const elevation = hasElevation
        ? elevationFlat.map((e) => e ?? 0)
        : undefined
      // Strip the per-leg elevation helper before storing leg segments.
      const cleanLegs: RouteSegment[] = legs.map(
        ({ elevation: _e, ...rest }) => rest,
      )
      const elevationGain = (trip.segments ?? []).reduce(
        (sum: number, s: any) => sum + (s.totalElevationGain ?? 0),
        0,
      )
      const elevationLoss = (trip.segments ?? []).reduce(
        (sum: number, s: any) => sum + (s.totalElevationLoss ?? 0),
        0,
      )
      const stats: RouteStats = {
        distance: trip.tripStats?.totalDistance ?? 0,
        duration: trip.tripStats?.totalDuration ?? 0,
        elevationGain: elevationGain || undefined,
        elevationLoss: elevationLoss || undefined,
      }

      store.setRouted({ geometry, elevation, segments: cleanLegs, stats })
    } catch (error) {
      if (axios.isCancel(error)) return
      console.error('[RouteBuilder] failed to connect waypoints:', error)
      // Preserve the last good geometry; surface a soft, retryable error.
      store.routeError = 'Routing failed — try again'
      lastKey.value = '' // allow the next change to retry from scratch
    } finally {
      if (abortController.value === controller) {
        store.isRouting = false
        abortController.value = null
      }
    }
  }

  /** Add a waypoint at a map location and reverse-geocode its label. */
  function addWaypointAt(lngLat: { lng: number; lat: number }) {
    store.addWaypoint({ lat: lngLat.lat, lng: lngLat.lng })
    void reverseGeocodeInto(store.waypoints.length - 1)
  }

  /** Move an existing waypoint (e.g. marker drag) and refresh its label. */
  function moveWaypointTo(index: number, lngLat: { lng: number; lat: number }) {
    store.moveWaypoint(index, { lat: lngLat.lat, lng: lngLat.lng })
    void reverseGeocodeInto(index)
  }

  async function reverseGeocodeInto(index: number) {
    const wp = store.waypoints[index]
    if (!wp) return
    try {
      const result = await geocodingService.reverseGeocode({
        lat: wp.lat,
        lng: wp.lng,
        limit: 1,
      })
      const place = result.results?.[0]
      const current = store.waypoints[index]
      // The point may have moved/been removed while we awaited — re-check.
      if (place && current && current.lat === wp.lat && current.lng === wp.lng) {
        current.name = getSearchResultName(place as Place)
      }
    } catch {
      // label is optional — leave it blank
    }
  }

  /** Build the persisted body from current builder state. */
  function buildBody(): RouteBody {
    return {
      waypoints: store.waypoints.map((w) => ({ ...w })),
      geometry: store.geometry,
      elevation: store.elevation.length ? store.elevation : undefined,
      segments: store.segments,
      pathMode: 'snap',
      stats: store.stats ?? undefined,
    }
  }

  /** Save the current build as a new route (or update the edited one). */
  async function save(meta: {
    name: string
    description?: string
    icon?: string
    iconColor?: string
    scheme?: RouteScheme
  }) {
    const body = buildBody()
    if (store.editingRouteId) {
      return await routesService.updateRoute(store.editingRouteId, {
        name: meta.name,
        description: meta.description,
        icon: meta.icon,
        iconColor: meta.iconColor,
        mode: store.mode,
        body,
      })
    }
    return await routesService.createRoute({
      name: meta.name,
      description: meta.description,
      icon: meta.icon,
      iconColor: meta.iconColor,
      mode: store.mode,
      scheme: meta.scheme ?? store.scheme,
      body,
    })
  }

  /**
   * Push the current route into the directions flow as via-waypoints. Lets a
   * built/saved route be turned into live directions (and, later, guided
   * navigation). Returns true if there was something to hand off.
   */
  function toDirections(): boolean {
    if (store.waypoints.length < 2) return false
    const directionsStore = useDirectionsStore()
    directionsStore.setWaypoints(
      store.waypoints.map((w) => ({
        lngLat: new LngLat(w.lng, w.lat),
        place: w.name
          ? ({
              id: `route-wp`,
              name: { value: w.name },
              geometry: {
                value: { type: 'point', center: { lat: w.lat, lng: w.lng } },
              },
              externalIds: {},
              address: null,
              placeType: { value: 'route_waypoint' },
            } as unknown as Place)
          : null,
      })),
    )
    directionsStore.selectedMode = backendMode(store.mode) as any
    return true
  }

  // Re-route whenever the waypoints or mode change while building.
  watch([waypoints, mode, isActive], connectDots, { deep: true })

  return {
    connectDots,
    addWaypointAt,
    moveWaypointTo,
    save,
    toDirections,
  }
}

export const useRouteBuilderService = createSharedComposable(routeBuilderService)
