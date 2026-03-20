/**
 * Marker Layers Service
 * 
 * Coordinates marker layers (waypoints, friends, trip instructions) that use Vue components
 * instead of traditional map layers. Manages initialization, watchers, and lifecycle.
 */

import type { LngLat } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { WaypointsLayer } from '@/components/map/layers/waypoints-layer'
import { FriendLocationsLayer } from '@/components/map/layers/friend-locations-layer'
import { TripInstructionsLayer } from '@/components/map/layers/trip-instructions-layer'
import { UserLocationLayer } from '@/components/map/layers/user-location-layer'
import { useDirectionsStore } from '@/stores/directions.store'
import { watch, Component } from 'vue'

export function useMarkerLayersService() {
  const directionsStore = useDirectionsStore()

  // Marker layer instances
  let waypointsLayer: WaypointsLayer | null = null
  let friendLocationsLayer: FriendLocationsLayer | null = null
  let tripInstructionsLayer: TripInstructionsLayer | null = null
  let userLocationLayer: UserLocationLayer | null = null

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize marker layers with map strategy
   * Call this after map is loaded
   */
  function initializeMarkerLayers(mapStrategy: MapStrategy) {
    // Create marker layer instances
    waypointsLayer = new WaypointsLayer()
    friendLocationsLayer = new FriendLocationsLayer()
    tripInstructionsLayer = new TripInstructionsLayer()
    userLocationLayer = new UserLocationLayer()

    // Initialize with map API
    const markerAPI = {
      addVueMarker: (
        id: string,
        lngLat: LngLat,
        component: Component,
        props: Record<string, any>,
        zIndex?: number,
      ) => mapStrategy?.addVueMarker(id, lngLat, component, props, zIndex),
      removeMarker: (id: string) => mapStrategy?.removeMarker(id),
      hasMarker: (id: string) => mapStrategy?.hasMarker(id) ?? false,
    }

    waypointsLayer.initialize(markerAPI)
    friendLocationsLayer.initialize(markerAPI)
    tripInstructionsLayer.initialize(markerAPI)
    userLocationLayer.initialize(markerAPI)

    // Set up watchers for reactive updates
    setupMarkerLayerWatchers()
  }

  /**
   * Set up watchers to sync marker layers with store state
   */
  function setupMarkerLayerWatchers() {
    // Watch for trip changes
    watch(
      () => directionsStore.trips,
      trips => {
        if (trips) {
          // Show the first trip by default (recommended or first in list)
          const firstTrip =
            trips.trips.find(trip => trip.isRecommended) || trips.trips[0]

          // Update instruction markers if showing single trip
          if (firstTrip) {
            tripInstructionsLayer?.setTrip(firstTrip)
          } else {
            tripInstructionsLayer?.setTrip(null)
          }
        } else {
          // Clear instruction markers when trips are cleared
          tripInstructionsLayer?.setTrip(null)
        }
      },
    )

    // Watch for selected trip changes
    watch(
      () => directionsStore.selectedTripId,
      selectedTripId => {
        const trips = directionsStore.trips
        if (!trips || !selectedTripId) {
          // Clear instruction markers when no trip is selected
          tripInstructionsLayer?.setTrip(null)
          return
        }

        // Update instruction markers for selected trip
        const trip = trips.trips.find(t => t.id === selectedTripId)
        tripInstructionsLayer?.setTrip(trip || null)
      },
    )
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Destroy marker layers and clean up
   */
  function destroyMarkerLayers() {
    waypointsLayer?.destroy()
    friendLocationsLayer?.destroy()
    tripInstructionsLayer?.destroy()
    userLocationLayer?.destroy()

    waypointsLayer = null
    friendLocationsLayer = null
    tripInstructionsLayer = null
    userLocationLayer = null
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
