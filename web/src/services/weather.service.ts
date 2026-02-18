import { ref, watch, computed } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { useMapStore } from '@/stores/map.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import type { WeatherData } from '@server/types/integration.types'
import { api } from '@/lib/api'
import { useI18n } from 'vue-i18n'

const MIN_ZOOM_LEVEL = 9 // Only show weather at zoom level 9 or higher
const UPDATE_DISTANCE_THRESHOLD = 25000 // Only update if moved more than 25km (in meters)
const UPDATE_TIME_THRESHOLD = 10 * 60 * 1000 // Only update every 10 minutes (in milliseconds)

interface WeatherCache {
  data: WeatherData | null
  lat: number
  lng: number
  timestamp: number
}

function weatherService() {
  const mapStore = useMapStore()
  const integrationsStore = useIntegrationsStore()
  const { locale } = useI18n()
  const weather = ref<WeatherData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const cache = ref<WeatherCache | null>(null)

  // Check if weather integration is available and active
  const isWeatherAvailable = computed(() => integrationsStore.isWeatherActive)

  /**
   * Calculate distance between two coordinates using Haversine formula
   * Returns distance in meters
   */
  function calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371e3 // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180
    const φ2 = (lat2 * Math.PI) / 180
    const Δφ = ((lat2 - lat1) * Math.PI) / 180
    const Δλ = ((lng2 - lng1) * Math.PI) / 180

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
  }

  /**
   * Check if we should update weather based on distance and time
   */
  function shouldUpdateWeather(lat: number, lng: number, zoom: number): boolean {
    // Don't update if zoom is too far out
    if (zoom < MIN_ZOOM_LEVEL) {
      return false
    }

    // Update if no cache exists
    if (!cache.value) {
      return true
    }

    const now = Date.now()
    const timeSinceUpdate = now - cache.value.timestamp

    // Update if enough time has passed
    if (timeSinceUpdate > UPDATE_TIME_THRESHOLD) {
      return true
    }

    // Update if moved significantly
    const distance = calculateDistance(
      cache.value.lat,
      cache.value.lng,
      lat,
      lng,
    )

    if (distance > UPDATE_DISTANCE_THRESHOLD) {
      return true
    }

    return false
  }

  /**
   * Fetch weather data for the given coordinates
   */
  async function fetchWeather(lat: number, lng: number): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Map i18n locale to OpenWeatherMap language codes
      // OpenWeatherMap supports codes like 'en', 'es', 'fr', etc.
      const lang = locale.value.split('-')[0] // Convert 'en-US' to 'en', 'es-ES' to 'es'
      
      const response = await api.get<WeatherData>('/weather', {
        params: { lat, lng, lang },
      })

      weather.value = response.data
      cache.value = {
        data: response.data,
        lat,
        lng,
        timestamp: Date.now(),
      }
    } catch (err: any) {
      console.error('Failed to fetch weather:', err)
      error.value = err.response?.data?.message || 'Failed to fetch weather data'
      weather.value = null
    } finally {
      loading.value = false
    }
  }

  /**
   * Update weather based on current map position
   */
  async function updateWeather(): Promise<void> {
    // Don't update if weather integration is not available
    if (!isWeatherAvailable.value) {
      weather.value = null
      return
    }

    const center = mapStore.mapCamera.center
    const zoom = mapStore.mapCamera.zoom

    if (!center) {
      return
    }

    const lat = Array.isArray(center) ? center[1] : center.lat
    const lng = Array.isArray(center) ? center[0] : ('lng' in center ? center.lng : center.lon)

    // Check if we should update
    if (!shouldUpdateWeather(lat, lng, zoom)) {
      // If we have cached data, use it
      if (cache.value && cache.value.data) {
        weather.value = cache.value.data
      }
      return
    }

    // Fetch new weather data
    await fetchWeather(lat, lng)
  }

  /**
   * Clear weather data and cache
   */
  function clearWeather(): void {
    weather.value = null
    cache.value = null
    error.value = null
  }

  /**
   * Watch for significant map camera changes
   */
  let updateTimeout: ReturnType<typeof setTimeout> | null = null
  watch(
    () => mapStore.mapCamera,
    (camera) => {
      // Clear any pending update
      if (updateTimeout) {
        clearTimeout(updateTimeout)
      }

      // Hide weather if zoomed out too far
      if (camera.zoom < MIN_ZOOM_LEVEL) {
        weather.value = null
        return
      }

      // Debounce updates (wait for camera to settle)
      updateTimeout = setTimeout(() => {
        updateWeather()
      }, 500)
    },
    { deep: true, immediate: true },
  )

  return {
    weather,
    loading,
    error,
    updateWeather,
    clearWeather,
  }
}

export const useWeatherService = createSharedComposable(weatherService)
