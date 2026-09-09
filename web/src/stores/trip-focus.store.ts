/**
 * Trip Focus Store
 *
 * The map's view of an open itinerary: which lines it rides, and where
 * their vehicles are. The trip's own polyline is drawn by the directions
 * layer group — this store only supplies what has to fade behind it and
 * what has to stay live on top of it.
 *
 * Deliberately NOT a portolan isolation like the route panel's: portolan
 * bundles routes at parallel slot offsets, so lifting the A out of the
 * tiles would draw it beside the trip line rather than under it. The trip
 * line is the subject here; the network just steps back.
 */

import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useDirectionsStore } from '@/stores/directions.store'
import { fetchVehiclesOnRoutes } from '@/lib/transit-vehicle-fetch'
import {
  focusedLegs,
  routeIdsByFeed,
  vehiclesOnFocusedRoutes,
  yourVehicleIds,
  type FocusedLeg,
} from '@/lib/transit-focus'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

/** Matches the route panel's cadence, so the two pages animate alike. */
const VEHICLE_POLL_MS = 5_000

export const useTripFocusStore = defineStore('trip-focus', () => {
  const directionsStore = useDirectionsStore()

  const vehicles = ref<Map<string, TransitVehiclePosition>>(new Map())

  /**
   * Trip ids resolved from a leg's departure board, by segment index.
   *
   * MOTIS names a run with its own encoded token, which the realtime feed
   * has never heard of; the board names it with the feed's own trip id,
   * which is exactly what a vehicle carries. The trip page pushes what its
   * board resolved, and that outranks the planner's id — including after a
   * rebooking, where the planner's id is the run the rider just abandoned.
   */
  const boardTripIds = ref<Record<number, string>>({})

  /** Whole map at once — the page resolves every leg's board together, and
   *  one write keeps the poll key from churning per leg. */
  function setLegTripIds(ids: Record<number, string>) {
    boardTripIds.value = ids
  }

  /** The trip on the map: the rider's pick, else the one the map defaults
   *  to when a fresh set of results lands. */
  const focusedTrip = computed(() => {
    const list = directionsStore.trips?.trips
    if (!list?.length) return null
    const selected = directionsStore.selectedTripId
    if (selected) return list.find((t) => t.id === selected) ?? null
    return list.find((t) => t.isRecommended) ?? list[0] ?? null
  })

  const legs = computed<FocusedLeg[]>(() =>
    focusedLegs(focusedTrip.value).map((leg) => ({
      ...leg,
      tripId: boardTripIds.value[leg.segmentIndex] ?? leg.tripId,
    })),
  )

  const isActive = computed(() => legs.value.length > 0)

  const visibleVehicleIds = computed(() =>
    vehiclesOnFocusedRoutes(legs.value, vehicles.value.values()),
  )

  const emphasizedVehicleIds = computed(() =>
    yourVehicleIds(legs.value, vehicles.value.values()),
  )

  // ── polling ──────────────────────────────────────────────────────
  let pollTimer: ReturnType<typeof setInterval> | null = null
  /** Bumps on every leg change, so a slow feed's answer for a trip the
   *  rider has already left never lands. */
  let fetchGeneration = 0

  async function fetchVehicles() {
    const byFeed = routeIdsByFeed(legs.value)
    if (!byFeed.size) return
    const gen = fetchGeneration

    const results = await Promise.all(
      [...byFeed].map(([feedId, routeIds]) =>
        fetchVehiclesOnRoutes(feedId, routeIds).catch(() => []),
      ),
    )
    if (gen !== fetchGeneration) return

    const next = new Map<string, TransitVehiclePosition>()
    for (const list of results) {
      for (const v of list) next.set(v.vehicleId, v)
    }
    vehicles.value = next
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // Keyed on the lines rather than the trip: switching between two
  // itineraries that ride the same trains should not blank the map.
  watch(
    () => [...routeIdsByFeed(legs.value)]
      .map(([feedId, ids]) => `${feedId}:${[...ids].sort().join(',')}`)
      .sort()
      .join('|'),
    (key) => {
      fetchGeneration++
      stopPolling()
      if (!key) {
        vehicles.value = new Map()
        return
      }
      void fetchVehicles()
      pollTimer = setInterval(fetchVehicles, VEHICLE_POLL_MS)
    },
    { immediate: true },
  )

  return {
    focusedTrip,
    legs,
    isActive,
    vehicles,
    visibleVehicleIds,
    emphasizedVehicleIds,
    setLegTripIds,
  }
})
