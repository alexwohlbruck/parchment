/**
 * Unit tests for directions store
 *
 * Tests cover:
 * - Waypoint management (add, remove, reorder, set)
 * - Trips and trip selection
 * - Routing preferences
 * - Loading state
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useDirectionsStore } from './directions.store'
import type { TripsResponse } from '@/types/directions.types'
import type { Waypoint } from '@/types/map.types'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    clear: () => {
      store = {}
    },
  }
})()
global.localStorage = localStorageMock as any

describe('useDirectionsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
  })

  describe('Initial state', () => {
    test('starts with two empty waypoints', () => {
      const store = useDirectionsStore()
      
      expect(store.waypoints).toHaveLength(2)
      expect(store.waypoints[0].lngLat).toBeNull()
      expect(store.waypoints[1].lngLat).toBeNull()
    })

    test('starts with no trips or directions', () => {
      const store = useDirectionsStore()
      
      expect(store.trips).toBeNull()
      expect(store.directions).toBeNull()
      expect(store.selectedTripId).toBeNull()
    })

    test('starts with default mode', () => {
      const store = useDirectionsStore()
      
      expect(store.selectedMode).toBe('multi')
    })

    test('loads mode from localStorage if available', () => {
      localStorageMock.setItem('selectedMode', 'car')
      
      const store = useDirectionsStore()
      
      expect(store.selectedMode).toBe('car')
    })

    test('starts with default routing preferences for biking (default mode)', () => {
      const store = useDirectionsStore()

      // selectedMode defaults to 'multi', which resolves to biking's slice
      // for the merged view
      expect(store.routingPreferences.ferries).toBe(0.5)
      expect(store.routingPreferences.hills).toBe(0.5)
      expect(store.routingPreferences.useKnownVehicleLocations).toBe(true)
    })

    test('mode-scoped defaults differ per mode', () => {
      const store = useDirectionsStore()

      expect(store.modePreferences.walking.hills).toBe(0.5)
      expect(store.modePreferences.biking.hills).toBe(0.5)
      expect(store.modePreferences.wheelchair.hills).toBe(0)
      expect(store.modePreferences.biking.surfaceQuality).toBe(0.25)
      expect(store.modePreferences.wheelchair.surfaceQuality).toBe(0.75)
      expect(store.modePreferences.driving.highways).toBe(0.5)
      expect(store.modePreferences.transit.maxWalkingDistance).toBe(1000)
    })

    test('merged routingPreferences tracks selectedMode', () => {
      const store = useDirectionsStore()

      store.selectedMode = 'walking'
      expect(store.routingPreferences.hills).toBe(0.5)
      expect(store.routingPreferences.ferries).toBe(0.5)

      store.selectedMode = 'wheelchair'
      expect(store.routingPreferences.hills).toBe(0)
      expect(store.routingPreferences.surfaceQuality).toBe(0.75)

      store.selectedMode = 'driving'
      expect(store.routingPreferences.highways).toBe(0.5)
      expect(store.routingPreferences.tolls).toBe(0.5)
    })
  })

  describe('setWaypoint', () => {
    test('sets waypoint at existing index', () => {
      const store = useDirectionsStore()
      const waypoint: Waypoint = {
        lngLat: { lat: 37.7749, lng: -122.4194 },
      }

      store.setWaypoint(0, waypoint)

      expect(store.waypoints[0]).toEqual(waypoint)
    })

    test('appends waypoint if index >= length', () => {
      const store = useDirectionsStore()
      const waypoint: Waypoint = {
        lngLat: { lat: 37.7749, lng: -122.4194 },
      }

      store.setWaypoint(5, waypoint)

      expect(store.waypoints).toHaveLength(3)
      expect(store.waypoints[2]).toEqual(waypoint)
    })
  })

  describe('setWaypoints', () => {
    test('replaces all waypoints', () => {
      const store = useDirectionsStore()
      const waypoints: Waypoint[] = [
        { lngLat: { lat: 37.7749, lng: -122.4194 } },
        { lngLat: { lat: 37.8044, lng: -122.2712 } },
        { lngLat: { lat: 37.7749, lng: -122.4194 } },
      ]

      store.setWaypoints(waypoints)

      expect(store.waypoints).toEqual(waypoints)
      expect(store.waypoints).toHaveLength(3)
    })
  })

  describe('removeWaypoint', () => {
    test('removes waypoint at index', () => {
      const store = useDirectionsStore()
      const waypoints: Waypoint[] = [
        { lngLat: { lat: 37.7749, lng: -122.4194 } },
        { lngLat: { lat: 37.8044, lng: -122.2712 } },
        { lngLat: { lat: 37.7749, lng: -122.4194 } },
      ]
      store.setWaypoints(waypoints)

      store.removeWaypoint(1)

      expect(store.waypoints).toHaveLength(2)
      expect(store.waypoints[0].lngLat).toEqual({ lat: 37.7749, lng: -122.4194 })
      expect(store.waypoints[1].lngLat).toEqual({ lat: 37.7749, lng: -122.4194 })
    })
  })

  describe('setTrips', () => {
    test('sets trips and auto-selects recommended trip', () => {
      const store = useDirectionsStore()
      const trips: TripsResponse = {
        request: { waypoints: [] },
        trips: [
          { id: 'trip-1', isRecommended: false } as any,
          { id: 'trip-2', isRecommended: true } as any,
          { id: 'trip-3', isRecommended: false } as any,
        ],
        earliestStart: new Date(0),
        latestEnd: new Date(0),
        metadata: { providers: [], processingTime: 0 },
      }

      store.setTrips(trips)

      expect(store.trips).toEqual(trips)
      expect(store.selectedTripId).toBe('trip-2')
    })

    test('auto-selects first trip if none recommended', () => {
      const store = useDirectionsStore()
      const trips: TripsResponse = {
        request: { waypoints: [] },
        trips: [
          { id: 'trip-1', isRecommended: false } as any,
          { id: 'trip-2', isRecommended: false } as any,
        ],
        earliestStart: new Date(0),
        latestEnd: new Date(0),
        metadata: { providers: [], processingTime: 0 },
      }

      store.setTrips(trips)

      expect(store.selectedTripId).toBe('trip-1')
    })

    test('does not set selectedTripId if no trips', () => {
      const store = useDirectionsStore()
      const trips: TripsResponse = {
        request: { waypoints: [] },
        trips: [],
        earliestStart: new Date(0),
        latestEnd: new Date(0),
        metadata: { providers: [], processingTime: 0 },
      }

      store.setTrips(trips)

      expect(store.selectedTripId).toBeNull()
    })
  })

  describe('unsetTrips', () => {
    test('clears trips and selectedTripId', () => {
      const store = useDirectionsStore()
      const trips: TripsResponse = {
        request: { waypoints: [] },
        trips: [{ id: 'trip-1', isRecommended: true } as any],
        earliestStart: new Date(0),
        latestEnd: new Date(0),
        metadata: { providers: [], processingTime: 0 },
      }
      store.setTrips(trips)

      store.unsetTrips()

      expect(store.trips).toBeNull()
      expect(store.selectedTripId).toBeNull()
    })
  })

  describe('setSelectedTripId', () => {
    test('sets selected trip id', () => {
      const store = useDirectionsStore()

      store.setSelectedTripId('trip-123')

      expect(store.selectedTripId).toBe('trip-123')
    })

    test('can clear selected trip id', () => {
      const store = useDirectionsStore()
      store.setSelectedTripId('trip-123')

      store.setSelectedTripId(null)

      expect(store.selectedTripId).toBeNull()
    })
  })

  describe('setLoading', () => {
    test('sets loading state', () => {
      const store = useDirectionsStore()

      store.setLoading(true)

      expect(store.isLoading).toBe(true)
    })
  })

  describe('setGeneralPreference', () => {
    test('updates a general preference shared across all modes', () => {
      const store = useDirectionsStore()

      store.setGeneralPreference('ferries', 0)

      expect(store.generalPreferences.ferries).toBe(0)
      // General prefs show up in the merged view regardless of mode
      store.selectedMode = 'walking'
      expect(store.routingPreferences.ferries).toBe(0)
      store.selectedMode = 'driving'
      expect(store.routingPreferences.ferries).toBe(0)
    })
  })

  describe('setModePreference', () => {
    test('updates a mode-scoped preference only on that mode', () => {
      const store = useDirectionsStore()

      store.setModePreference('walking', 'hills', 0)

      expect(store.modePreferences.walking.hills).toBe(0)
      // Biking should NOT be affected — modes are independent
      expect(store.modePreferences.biking.hills).toBe(0.5)
    })

    test('walking and biking hills stay independent', () => {
      const store = useDirectionsStore()

      store.setModePreference('walking', 'hills', 0.2)
      store.setModePreference('biking', 'hills', 0.8)

      expect(store.modePreferences.walking.hills).toBe(0.2)
      expect(store.modePreferences.biking.hills).toBe(0.8)
    })
  })

  describe('localStorage persistence', () => {
    test('saves selectedMode to localStorage on change', async () => {
      const store = useDirectionsStore()

      store.selectedMode = 'biking'
      await nextTick()
      await nextTick() // Wait for watcher to trigger
      
      expect(localStorageMock.getItem('selectedMode')).toBe('biking')
    })

    test('saves general preferences to localStorage on change', async () => {
      const store = useDirectionsStore()

      store.setGeneralPreference('ferries', 0)
      await nextTick()
      await nextTick() // Wait for watcher to trigger

      const stored = localStorageMock.getItem('routingPreferences')
      expect(stored).toBeTruthy()
      const parsed = JSON.parse(stored!)
      expect(parsed.general.ferries).toBe(0)
    })

    test('saves mode preferences to localStorage on change', async () => {
      const store = useDirectionsStore()

      store.setModePreference('biking', 'hills', 0.1)
      await nextTick()
      await nextTick()

      const stored = localStorageMock.getItem('routingPreferences')
      expect(stored).toBeTruthy()
      const parsed = JSON.parse(stored!)
      expect(parsed.mode.biking.hills).toBe(0.1)
      // Walking slice unchanged
      expect(parsed.mode.walking.hills).toBe(0.5)
    })

    test('migrates legacy flat format from localStorage', () => {
      localStorageMock.setItem(
        'routingPreferences',
        JSON.stringify({
          ferries: 0.25,
          hills: 0.2,
          highways: 0.75,
        }),
      )

      const store = useDirectionsStore()

      // General key lands in general
      expect(store.generalPreferences.ferries).toBe(0.25)
      // Non-general keys get applied to every mode (best-effort migration)
      expect(store.modePreferences.walking.hills).toBe(0.2)
      expect(store.modePreferences.biking.hills).toBe(0.2)
      expect(store.modePreferences.driving.highways).toBe(0.75)
    })
  })
})
