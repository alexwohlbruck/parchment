/**
 * Marker Layers Service
 * 
 * Coordinates marker layers (waypoints, friends, trip instructions) that use Vue components
 * instead of traditional map layers. Manages initialization, watchers, and lifecycle.
 */

import type { LngLat } from '@/types/map.types'
import { MapStrategy } from '@/services/map/providers/map.strategy'
import { WaypointsLayer } from '@/services/layers/markers/waypoints-layer'
import type { MarkerDragOptions } from '@/services/layers/markers/base-marker-layer'
import { FriendLocationsLayer } from '@/services/layers/markers/friend-locations-layer'
import { TripInstructionsLayer } from '@/services/layers/markers/trip-instructions-layer'
import { TripStopsLayer } from '@/services/layers/markers/trip-stops-layer'
import { UserLocationLayer } from '@/services/layers/markers/user-location-layer'
import { TrackerLocationsLayer } from '@/services/layers/markers/tracker-locations-layer'
import { TransitVehiclesLayer } from '@/services/layers/features/transit-vehicles-layer'
import {
  RouteBuilderLayer,
  RouteBuilderLineLayer,
  RouteBuilderTurnaroundLayer,
} from '@/services/layers/markers/route-builder-layer'
import { useDirectionsStore } from '@/stores/directions.store'
import { useTransitVehiclesStore } from '@/stores/transit-vehicles.store'
import { useRouteIsolationService } from '@/services/layers/features/route-isolation.service'
import { useTripIsolationService } from '@/services/layers/features/trip-isolation.service'
import type { FitBoundsFn } from '@/types/map.types'
import { watch, Component, type WatchStopHandle } from 'vue'

export function useMarkerLayersService() {
  const directionsStore = useDirectionsStore()

  // Marker layer instances
  let waypointsLayer: WaypointsLayer | null = null
  let friendLocationsLayer: FriendLocationsLayer | null = null
  let tripInstructionsLayer: TripInstructionsLayer | null = null
  let tripStopsLayer: TripStopsLayer | null = null
  let userLocationLayer: UserLocationLayer | null = null
  let trackerLocationsLayer: TrackerLocationsLayer | null = null
  let transitVehiclesLayer: TransitVehiclesLayer | null = null
  let routeBuilderLayer: RouteBuilderLayer | null = null
  let routeBuilderLineLayer: RouteBuilderLineLayer | null = null
  let routeBuilderTurnaroundLayer: RouteBuilderTurnaroundLayer | null = null
  let watchStops: WatchStopHandle[] = []
  let moveEndCleanup: (() => void) | null = null
  let routeIsolation: ReturnType<typeof useRouteIsolationService> | null = null
  let tripIsolation: ReturnType<typeof useTripIsolationService> | null = null

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize marker layers with map strategy
   * Call this after map is loaded
   */
  function initializeMarkerLayers(mapStrategy: MapStrategy, fitBounds?: FitBoundsFn) {
    // Destroy any existing layers first (style.load fires on basemap/theme
    // changes, not just initial load — without this, old layers leak watchers
    // and orphan markers).
    destroyMarkerLayers()

    // Create marker layer instances
    waypointsLayer = new WaypointsLayer()
    friendLocationsLayer = new FriendLocationsLayer()
    tripInstructionsLayer = new TripInstructionsLayer()
    tripStopsLayer = new TripStopsLayer()
    userLocationLayer = new UserLocationLayer()
    trackerLocationsLayer = new TrackerLocationsLayer()
    transitVehiclesLayer = new TransitVehiclesLayer()
    routeBuilderLayer = new RouteBuilderLayer()
    routeBuilderLineLayer = new RouteBuilderLineLayer(mapStrategy)
    routeBuilderTurnaroundLayer = new RouteBuilderTurnaroundLayer()

    // Initialize with map API
    const markerAPI = {
      addVueMarker: (
        id: string,
        lngLat: LngLat,
        component: Component,
        props: Record<string, any>,
        zIndex?: number,
        dragOptions?: MarkerDragOptions,
      ) =>
        mapStrategy?.addVueMarker(
          id,
          lngLat,
          component,
          props,
          zIndex,
          dragOptions,
        ),
      removeMarker: (id: string) => mapStrategy?.removeMarker(id),
      hasMarker: (id: string) => mapStrategy?.hasMarker(id) ?? false,
      setMarkerLngLat: (id: string, lngLat: LngLat) =>
        mapStrategy?.setMarkerLngLat(id, lngLat),
      setMarkerHeading: (id: string, heading: number | null, spread?: number) =>
        mapStrategy?.setMarkerHeading(id, heading, spread),
    }

    waypointsLayer.initialize(markerAPI)
    friendLocationsLayer.initialize(markerAPI)
    tripInstructionsLayer.initialize(markerAPI)
    tripStopsLayer.initialize(markerAPI)
    userLocationLayer.initialize(markerAPI)
    trackerLocationsLayer.initialize(markerAPI)
    transitVehiclesLayer.initialize(markerAPI)
    transitVehiclesLayer.setGetBounds(() => mapStrategy.getBounds())
    routeBuilderLayer.initialize(markerAPI)
    routeBuilderLineLayer.initialize()
    routeBuilderTurnaroundLayer.initialize(markerAPI)

    const transitVehiclesStore = useTransitVehiclesStore()
    let moveEndTimer: ReturnType<typeof setTimeout> | null = null
    const onMoveEnd = () => {
      if (moveEndTimer) clearTimeout(moveEndTimer)
      moveEndTimer = setTimeout(() => transitVehiclesStore.updateViewport(), 500)
    }
    mapStrategy.mapInstance.on('moveend', onMoveEnd)
    moveEndCleanup = () => {
      if (moveEndTimer) clearTimeout(moveEndTimer)
      mapStrategy.mapInstance.off('moveend', onMoveEnd)
    }

    // Route isolation: highlights active transit route on the map
    routeIsolation = useRouteIsolationService()
    routeIsolation.initialize(mapStrategy.mapInstance, fitBounds)

    // Trip isolation: dims the network behind an open itinerary's line
    // and draws that line's own stops on top of it
    tripIsolation = useTripIsolationService()
    tripIsolation.initialize(mapStrategy.mapInstance)

    // Set up watchers for reactive updates
    setupMarkerLayerWatchers()
  }

  /**
   * Set up watchers to sync marker layers with store state
   */
  function setupMarkerLayerWatchers() {
    // Instruction points and the plan's own stops both belong to whichever
    // single trip is on the map, so they follow the same trip.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const showTrip = (trip: any | null) => {
      tripInstructionsLayer?.setTrip(trip)
      tripStopsLayer?.setTrip(trip)
    }

    watchStops.push(watch(
      () => directionsStore.trips,
      trips => {
        if (!trips) {
          showTrip(null)
          return
        }
        // Show the first trip by default (recommended or first in list)
        showTrip(
          trips.trips.find(trip => trip.isRecommended) || trips.trips[0] || null,
        )
      },
    ))

    watchStops.push(watch(
      () => directionsStore.selectedTripId,
      selectedTripId => {
        const trips = directionsStore.trips
        if (!trips || !selectedTripId) {
          showTrip(null)
          return
        }

        showTrip(trips.trips.find(t => t.id === selectedTripId) || null)
      },
    ))
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Destroy marker layers and clean up
   */
  function destroyMarkerLayers() {
    watchStops.forEach(stop => stop())
    watchStops = []
    moveEndCleanup?.()
    moveEndCleanup = null
    routeIsolation?.destroy()
    routeIsolation = null
    tripIsolation?.destroy()
    tripIsolation = null

    waypointsLayer?.destroy()
    friendLocationsLayer?.destroy()
    tripInstructionsLayer?.destroy()
    tripStopsLayer?.destroy()
    userLocationLayer?.destroy()
    trackerLocationsLayer?.destroy()
    transitVehiclesLayer?.destroy()
    routeBuilderLayer?.destroy()
    routeBuilderLineLayer?.destroy()
    routeBuilderTurnaroundLayer?.destroy()

    waypointsLayer = null
    friendLocationsLayer = null
    tripInstructionsLayer = null
    tripStopsLayer = null
    userLocationLayer = null
    trackerLocationsLayer = null
    transitVehiclesLayer = null
    routeBuilderLayer = null
    routeBuilderLineLayer = null
    routeBuilderTurnaroundLayer = null
  }

  // ============================================================================
  // INSTRUCTION HIGHLIGHTING (for UI interactions)
  // ============================================================================

  /**
   * Highlight a specific instruction point (for UI interactions)
   */
  function highlightInstructionPoint(
    segmentIndex: number,
    instructionIndex: number,
  ) {
    tripInstructionsLayer?.highlightInstruction(segmentIndex, instructionIndex)
  }

  /**
   * Clear highlighted instruction point
   */
  function clearHighlightedInstructionPoint() {
    tripInstructionsLayer?.clearHighlight()
  }

  return {
    initializeMarkerLayers,
    destroyMarkerLayers,
    highlightInstructionPoint,
    clearHighlightedInstructionPoint,
  }
}
