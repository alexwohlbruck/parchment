import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import type { UserVehicle, LocationStaleness } from '@/types/multimodal.types'
import { getRoutingMode } from '@/lib/vehicle-mode-mapping'

export const useVehiclesStore = defineStore('vehicles', () => {
  const vehicles = ref<UserVehicle[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** When set, the map is in "pick location" mode for this vehicle */
  const pickingLocationForVehicleId = ref<string | null>(null)

  const pickingVehicle = computed(() =>
    pickingLocationForVehicleId.value
      ? vehicles.value.find((v) => v.id === pickingLocationForVehicleId.value) ?? null
      : null,
  )

  // ── Getters ──────────────────────────────────────────────────────────

  const activeVehicles = computed(() =>
    vehicles.value.filter((v) => v.isActive),
  )

  const activeDrivingVehicle = computed(() =>
    activeVehicles.value.find((v) => getRoutingMode(v.type) === 'driving'),
  )

  const activeBikingVehicle = computed(() =>
    activeVehicles.value.find((v) => getRoutingMode(v.type) === 'biking'),
  )

  function getLocationStaleness(vehicle: UserVehicle): LocationStaleness {
    if (!vehicle.locationUpdatedAt) return 'unknown'
    const ageMs = Date.now() - new Date(vehicle.locationUpdatedAt).getTime()
    const hours = ageMs / (1000 * 60 * 60)
    if (hours < 2) return 'fresh'
    if (hours < 24) return 'aging'
    if (hours < 168) return 'stale' // 7 days
    return 'very-stale'
  }

  // ── Actions ──────────────────────────────────────────────────────────

  async function fetchVehicles() {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<{ vehicles: UserVehicle[] }>('/vehicles/')
      vehicles.value = data.vehicles
    } catch (e: any) {
      error.value = e.message || 'Failed to fetch vehicles'
    } finally {
      loading.value = false
    }
  }

  async function createVehicle(data: {
    type: string
    energyType?: string
    name?: string
  }) {
    const { data: result } = await api.post<{ vehicle: UserVehicle }>(
      '/vehicles/',
      data,
    )
    vehicles.value.push(result.vehicle)

    // If the new vehicle was auto-activated, deactivate other same-mode vehicles locally
    if (result.vehicle.isActive) {
      const mode = getRoutingMode(result.vehicle.type)
      vehicles.value.forEach((v) => {
        if (
          v.id !== result.vehicle.id &&
          getRoutingMode(v.type) === mode &&
          v.isActive
        ) {
          v.isActive = false
        }
      })
    }

    return result.vehicle
  }

  async function updateVehicle(
    vehicleId: string,
    data: { type?: string; energyType?: string | null; name?: string | null },
  ) {
    const { data: result } = await api.patch<{ vehicle: UserVehicle }>(
      `/vehicles/${vehicleId}`,
      data,
    )
    const idx = vehicles.value.findIndex((v) => v.id === vehicleId)
    if (idx !== -1) vehicles.value[idx] = result.vehicle
    return result.vehicle
  }

  async function deleteVehicle(vehicleId: string) {
    await api.delete(`/vehicles/${vehicleId}`)
    vehicles.value = vehicles.value.filter((v) => v.id !== vehicleId)
    // Refresh to pick up any auto-promoted active vehicle
    await fetchVehicles()
  }

  async function setActiveVehicle(vehicleId: string) {
    const { data: result } = await api.post<{ vehicle: UserVehicle }>(
      `/vehicles/${vehicleId}/activate`,
    )
    // Refresh all vehicles to get updated isActive states
    await fetchVehicles()
    return result.vehicle
  }

  async function updateVehicleLocation(
    vehicleId: string,
    location: { lat: number; lng: number },
    source: 'manual' | 'inferred' | 'tracker' = 'manual',
  ) {
    const { data: result } = await api.put<{ vehicle: UserVehicle }>(
      `/vehicles/${vehicleId}/location`,
      { lat: location.lat, lng: location.lng, source },
    )
    const idx = vehicles.value.findIndex((v) => v.id === vehicleId)
    if (idx !== -1) vehicles.value[idx] = result.vehicle
    return result.vehicle
  }

  return {
    // State
    vehicles,
    loading,
    error,
    pickingLocationForVehicleId,
    pickingVehicle,
    // Getters
    activeVehicles,
    activeDrivingVehicle,
    activeBikingVehicle,
    getLocationStaleness,
    // Actions
    fetchVehicles,
    createVehicle,
    updateVehicle,
    deleteVehicle,
    setActiveVehicle,
    updateVehicleLocation,
  }
})
