/**
 * Geolocation Service
 *
 * Centralized geolocation service that provides reactive user location data
 * to all parts of the application. Uses VueUse's useGeolocation under the hood.
 *
 * Tracking starts when resume() is first called — the browser silently succeeds if
 * permission is already granted, or prompts if not yet decided. While held, resume()
 * waits until the hold is lifted, so nothing prompts mid-onboarding.
 */

import { computed, ref, shallowRef, watch } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import type { LngLat } from '@/types/map.types'
import { usePowerStore } from '@/stores/power.store'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { locationWatchOptions } from '@/lib/power/power-saver'

export type GeolocationPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

function geolocationService() {
  const power = usePowerStore()
  const isSupported = computed(() => typeof navigator !== 'undefined' && 'geolocation' in navigator)
  const coords = ref<Omit<GeolocationCoordinates, 'toJSON'>>({
    accuracy: 0,
    latitude: Infinity,
    longitude: Infinity,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  })
  const locatedAt = ref<number | null>(null)
  const error = shallowRef<GeolocationPositionError | null>(null)
  const watchOptions = computed(() => locationWatchOptions(power.saver, guidanceEngine.active.value))
  let watchId: number | undefined

  function resume() {
    if (!isSupported.value || watchId !== undefined) return
    watchId = navigator.geolocation.watchPosition(
      position => {
        locatedAt.value = position.timestamp
        coords.value = position.coords
        error.value = null
      },
      e => (error.value = e),
      watchOptions.value,
    )
  }

  function pause() {
    if (watchId === undefined) return
    navigator.geolocation.clearWatch(watchId)
    watchId = undefined
  }

  // A watch keeps the options it started with.
  watch(watchOptions, () => {
    if (watchId === undefined) return
    pause()
    resume()
  })

  const permissionState = ref<GeolocationPermissionState>('unknown')

  // Track permission state changes via Permissions API (non-blocking)
  if (typeof navigator !== 'undefined' && navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' }).then(status => {
      permissionState.value = status.state as GeolocationPermissionState
      status.addEventListener('change', () => {
        permissionState.value = status.state as GeolocationPermissionState
      })
    })
  }

  // Update permission state when we get coordinates or errors
  watch(coords, (c) => {
    if (c.latitude !== Infinity) {
      permissionState.value = 'granted'
    }
  })

  watch(error, (e) => {
    if (e?.code === GeolocationPositionError.PERMISSION_DENIED) {
      permissionState.value = 'denied'
    }
  })

  const hasLocation = computed(() => {
    return coords.value.latitude !== Infinity && coords.value.longitude !== Infinity
  })

  const lngLat = computed<LngLat | null>(() => {
    if (!hasLocation.value) return null
    return {
      lng: coords.value.longitude,
      lat: coords.value.latitude,
    }
  })

  const accuracy = computed<number | null>(() => {
    if (!hasLocation.value) return null
    return coords.value.accuracy
  })

  const heading = computed<number | null>(() => {
    if (!hasLocation.value || coords.value.heading === null) return null
    return coords.value.heading
  })

  /**
   * Request geolocation permission and start tracking.
   * If already tracking, this is a no-op.
   */
  let held = false
  let wanted = false

  function startTracking() {
    wanted = true
    if (!held) resume()
  }

  function hold(value: boolean) {
    held = value
    if (!held && wanted) resume()
  }

  return {
    coords,
    locatedAt,
    error,
    isSupported,
    permissionState,
    hasLocation,
    lngLat,
    accuracy,
    heading,
    resume: startTracking,
    pause,
    hold,
  }
}

export const useGeolocationService = createSharedComposable(geolocationService)
