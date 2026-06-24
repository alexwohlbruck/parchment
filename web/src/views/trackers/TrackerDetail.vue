<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { useMapService } from '@/services/map.service'
import { useDirectionsService } from '@/services/directions.service'
import { useVehicleLocationPicker } from '@/composables/useVehicleLocationPicker'
import { VEHICLE_TYPE_LABELS } from '@/lib/vehicle-mode-mapping'
import type { VehicleType } from '@/types/multimodal.types'
import { AppRoute } from '@/router'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  CarFrontIcon,
  BikeIcon,
  TruckIcon,
  AccessibilityIcon,
  MapPinIcon,
  MapPinOffIcon,
  CrosshairIcon,
  ArrowRightIcon,
  SettingsIcon,
  type LucideIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  id: string
}>()

const router = useRouter()
const vehiclesStore = useVehiclesStore()
const mapService = useMapService()
const directionsService = useDirectionsService()
const { startPicking } = useVehicleLocationPicker()
const { vehicles } = storeToRefs(vehiclesStore)

const vehicleTypeIcons: Record<string, LucideIcon> = {
  car: CarFrontIcon,
  truck: TruckIcon,
  moped: BikeIcon,
  bike: BikeIcon,
  'e-bike': BikeIcon,
  scooter: BikeIcon,
  'e-scooter': BikeIcon,
  wheelchair: AccessibilityIcon,
}

const vehicle = computed(() =>
  vehicles.value.find((v) => v.id === props.id),
)

const displayName = computed(() => {
  if (!vehicle.value) return 'Unknown'
  return vehicle.value.name || VEHICLE_TYPE_LABELS[vehicle.value.type as VehicleType] || vehicle.value.type
})

const IconComponent = computed(() => {
  if (!vehicle.value) return MapPinIcon
  return vehicleTypeIcons[vehicle.value.type] || MapPinIcon
})

const staleness = computed(() => {
  if (!vehicle.value) return 'unknown'
  return vehiclesStore.getLocationStaleness(vehicle.value)
})

const isLocationFresh = computed(() => {
  return staleness.value === 'fresh' || staleness.value === 'aging'
})

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function centerOnMap() {
  if (!vehicle.value?.lastKnownLocation) return
  mapService.flyTo({
    center: [
      vehicle.value.lastKnownLocation.lng,
      vehicle.value.lastKnownLocation.lat,
    ],
    zoom: 15,
  })
}

function getDirections() {
  if (!vehicle.value?.lastKnownLocation) return
  const { lat, lng } = vehicle.value.lastKnownLocation
  directionsService.directionsTo({
    lngLat: { lng, lat },
    place: {
      id: `vehicle-${vehicle.value.id}`,
      name: { value: displayName.value } as any,
      geometry: { value: { type: 'point', center: { lat, lng } } } as any,
      externalIds: {},
      address: null,
      placeType: { value: 'vehicle' } as any,
    },
  })
  router.push({ name: AppRoute.DIRECTIONS })
}

function setLocation() {
  if (!vehicle.value) return
  startPicking(vehicle.value.id, `/lookout/tracker/${vehicle.value.id}`)
}

function goToSettings() {
  router.push({ name: AppRoute.VEHICLES })
}

onMounted(() => {
  centerOnMap()
})

// Redirect if vehicle not found
watch(vehicle, (v) => {
  if (!v) {
    router.push({ name: AppRoute.LOOKOUT })
  }
})
</script>

<template>
  <div v-if="!vehicle" class="h-full flex items-center justify-center">
    <div class="animate-pulse text-muted-foreground">Loading...</div>
  </div>

  <div v-else class="h-full flex flex-col">
    <div class="flex-1 overflow-y-auto pt-2 pb-4">
      <div class="px-4">

        <!-- Hero -->
        <div class="flex flex-col items-center pt-2 pb-5">
          <div
            class="flex items-center justify-center size-20 rounded-full ring-4 ring-background shadow-lg"
            :class="isLocationFresh ? 'bg-foreground' : 'bg-muted-foreground'"
          >
            <component
              :is="IconComponent"
              class="size-10"
              :class="isLocationFresh ? 'text-background' : 'text-muted'"
            />
          </div>

          <p class="text-xl font-semibold mt-3">{{ displayName }}</p>

          <p v-if="vehicle.name" class="text-sm text-muted-foreground">
            {{ VEHICLE_TYPE_LABELS[vehicle.type as VehicleType] || vehicle.type }}
          </p>

          <!-- Status pill -->
          <div v-if="vehicle.lastKnownLocation" class="mt-2.5">
            <div
              class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              :class="isLocationFresh
                ? 'bg-forest-500/10 text-forest-700 dark:text-forest-400'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'"
            >
              <div
                class="size-1.5 rounded-full"
                :class="isLocationFresh ? 'bg-forest-500' : 'bg-amber-500'"
              />
              {{ isLocationFresh ? 'Updated' : 'Last seen' }}
              <template v-if="vehicle.locationUpdatedAt">
                &middot;
                {{ formatTimeAgo(vehicle.locationUpdatedAt) }}
              </template>
            </div>
          </div>
          <div v-else class="mt-2.5">
            <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              <MapPinOffIcon class="size-3" />
              No location set
            </div>
          </div>

          <!-- Action buttons -->
          <div class="flex items-center gap-2 mt-4 w-full">
            <Button
              class="flex-1 gap-2"
              :disabled="!vehicle.lastKnownLocation"
              @click="getDirections"
            >
              <ArrowRightIcon class="size-4" />
              Directions
            </Button>
            <Button
              variant="outline"
              class="flex-1 gap-2"
              @click="setLocation"
            >
              <CrosshairIcon class="size-4" />
              Set location
            </Button>
          </div>
        </div>

        <Separator />

        <!-- Details -->
        <div class="py-4 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">Type</span>
            <span class="text-sm font-medium">
              {{ VEHICLE_TYPE_LABELS[vehicle.type as VehicleType] || vehicle.type }}
            </span>
          </div>

          <div v-if="vehicle.energyType" class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">Fuel</span>
            <span class="text-sm font-medium capitalize">{{ vehicle.energyType }}</span>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">Status</span>
            <Badge :variant="vehicle.isActive ? 'secondary' : 'outline'" class="text-xs">
              {{ vehicle.isActive ? 'Active' : 'Inactive' }}
            </Badge>
          </div>

          <div v-if="vehicle.locationSource !== 'manual'" class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">Source</span>
            <span class="text-sm font-medium capitalize">{{ vehicle.locationSource }}</span>
          </div>
        </div>

        <Separator />

        <!-- Settings link -->
        <div class="py-4">
          <Button variant="ghost" class="w-full justify-start gap-2" @click="goToSettings">
            <SettingsIcon class="size-4" />
            Manage vehicles
          </Button>
        </div>

      </div>
    </div>
  </div>
</template>
