/**
 * Transit Focus Store
 *
 * The one answer to "is the map showing a particular piece of transit,
 * and which vehicles belong to it" — asked by the vehicle layer and by
 * the network dim, answered by whichever page owns the map.
 *
 * Two pages can own it: the route panel, which lifts one line out of the
 * network, and an open itinerary, which rides several. They differ in
 * what they highlight; they agree on how vehicles read, which is why that
 * part lives here rather than in either of them.
 *
 * The route panel wins a tie. Opening a line from inside a trip is a
 * deliberate narrowing, and the narrower view is the one the rider asked
 * for.
 */

import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useRouteDetailStore } from '@/stores/route-detail.store'
import { useTripFocusStore } from '@/stores/trip-focus.store'
import type { FocusedStop } from '@/lib/transit-focus'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

export type TransitFocusSource = 'route' | 'trip'

const NO_IDS: ReadonlySet<string> = new Set()
const NO_VEHICLES: ReadonlyMap<string, TransitVehiclePosition> = new Map()

export const useTransitFocusStore = defineStore('transit-focus', () => {
  const routeDetail = useRouteDetailStore()
  const tripFocus = useTripFocusStore()

  const source = computed<TransitFocusSource | null>(() =>
    routeDetail.isActive ? 'route' : tripFocus.isActive ? 'trip' : null,
  )

  const isActive = computed(() => source.value !== null)

  /** Where the vehicles on screen come from. Each owner polls its own
   *  routes, so neither has to care about the viewport. */
  const vehicles = computed<ReadonlyMap<string, TransitVehiclePosition>>(() => {
    if (source.value === 'route') return routeDetail.vehicles
    if (source.value === 'trip') return tripFocus.vehicles
    return NO_VEHICLES
  })

  /** Vehicles allowed on the map at all. */
  const visibleVehicleIds = computed<ReadonlySet<string>>(() => {
    if (source.value === 'route') return routeDetail.directionFilteredVehicleIds
    if (source.value === 'trip') return tripFocus.visibleVehicleIds
    return NO_IDS
  })

  /**
   * The vehicles that are the rider's. Non-empty means every other
   * visible vehicle renders dimmed; empty means none of them do — a page
   * that cannot say which train is yours must not fade the others behind
   * a guess.
   */
  const emphasizedVehicleIds = computed<ReadonlySet<string>>(() => {
    if (source.value === 'route') {
      return routeDetail.selectedVehicleId
        ? new Set([routeDetail.selectedVehicleId])
        : NO_IDS
    }
    if (source.value === 'trip') return tripFocus.emphasizedVehicleIds
    return NO_IDS
  })

  /**
   * Stops the focused transit calls at, so the vehicle animation can
   * constrain a run to the stop it is next due at rather than free-run it
   * along the shape. A trip contributes every leg's stops; ids are
   * feed-local on both sides, and a lookup is by id, so the union is safe.
   */
  const focusedStops = computed<FocusedStop[]>(() => {
    if (source.value === 'route') {
      return (routeDetail.activeRoute?.stops ?? []).map((s) => ({
        stopId: s.stopId,
        lat: s.lat,
        lng: s.lng,
      }))
    }
    if (source.value === 'trip') return tripFocus.legs.flatMap((leg) => leg.stops)
    return []
  })

  /** The route panel's own route data is the authority on a line's mode;
   *  the vehicle feed's enrichment cache can be stale about it. */
  const routeTypeOverride = computed(() =>
    source.value === 'route' ? routeDetail.activeRoute?.routeType ?? undefined : undefined,
  )

  /** Route detail alone owns a selection the rider can change. */
  function selectVehicle(vehicleId: string | null) {
    if (source.value === 'route') routeDetail.selectVehicle(vehicleId)
  }

  return {
    source,
    isActive,
    vehicles,
    visibleVehicleIds,
    emphasizedVehicleIds,
    focusedStops,
    routeTypeOverride,
    selectVehicle,
  }
})
