<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { getRoutingMode, VEHICLE_TYPE_LABELS } from '@/lib/vehicle-mode-mapping'
import type { UserVehicle, VehicleType } from '@/types/multimodal.types'
import { AppRoute } from '@/router'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import {
  CarFrontIcon,
  BikeIcon,
  TruckIcon,
  AccessibilityIcon,
  MapPinIcon,
  MapPinOffIcon,
  type LucideIcon,
} from 'lucide-vue-next'

const router = useRouter()
const vehiclesStore = useVehiclesStore()
const { vehicles, loading } = storeToRefs(vehiclesStore)

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

function getIcon(type: string): LucideIcon {
  return vehicleTypeIcons[type] || MapPinIcon
}

function formatRelativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getLocationLabel(vehicle: UserVehicle): string {
  if (!vehicle.lastKnownLocation) return 'No location'
  if (!vehicle.locationUpdatedAt) return 'Location set'
  return `Updated ${formatRelativeTime(vehicle.locationUpdatedAt)}`
}

function getStalenessClass(vehicle: UserVehicle): string {
  const staleness = vehiclesStore.getLocationStaleness(vehicle)
  switch (staleness) {
    case 'fresh':
    case 'aging':
      return 'text-muted-foreground'
    case 'stale':
      return 'text-yellow-600 dark:text-yellow-500'
    case 'very-stale':
      return 'text-destructive'
    default:
      return 'text-muted-foreground'
  }
}

const trackedVehicles = computed(() =>
  vehicles.value.filter((v) => v.lastKnownLocation),
)

const untrackedVehicles = computed(() =>
  vehicles.value.filter((v) => !v.lastKnownLocation),
)

function openDetail(vehicle: UserVehicle) {
  router.push({
    name: AppRoute.TRACKER_DETAIL,
    params: { id: vehicle.id },
  })
}
</script>

<template>
  <PanelLayout>
    <h1 class="text-2xl font-semibold mb-3">Trackers</h1>

    <!-- Empty state -->
    <div v-if="!loading && vehicles.length === 0" class="py-8 text-center">
      <MapPinIcon class="mx-auto mb-3 size-10 text-muted-foreground/50" />
      <p class="text-sm text-muted-foreground">
        No trackers yet. Add vehicles in settings to track their locations on the map.
      </p>
    </div>

    <!-- Tracked items -->
    <div v-else class="space-y-1">
      <template v-if="trackedVehicles.length">
        <p class="text-xs font-medium text-muted-foreground mb-1.5 px-1">Active</p>
        <Card
          v-for="vehicle in trackedVehicles"
          :key="vehicle.id"
          class="flex items-center gap-3 p-3 cursor-pointer hover:bg-secondary/40 transition-colors border shadow-none"
          @click="openDetail(vehicle)"
        >
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <component :is="getIcon(vehicle.type)" class="size-5 text-foreground" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium truncate">
                {{ vehicle.name || VEHICLE_TYPE_LABELS[vehicle.type as VehicleType] || vehicle.type }}
              </span>
              <Badge v-if="vehicle.isActive" variant="secondary" class="text-[10px] px-1.5 py-0">
                active
              </Badge>
            </div>
            <div class="flex items-center gap-1 mt-0.5">
              <MapPinIcon class="size-3" :class="getStalenessClass(vehicle)" />
              <span class="text-xs" :class="getStalenessClass(vehicle)">
                {{ getLocationLabel(vehicle) }}
              </span>
            </div>
          </div>
        </Card>
      </template>

      <template v-if="untrackedVehicles.length">
        <p class="text-xs font-medium text-muted-foreground mt-4 mb-1.5 px-1">No location</p>
        <Card
          v-for="vehicle in untrackedVehicles"
          :key="vehicle.id"
          class="flex items-center gap-3 p-3 cursor-pointer hover:bg-secondary/40 transition-colors border shadow-none"
          @click="openDetail(vehicle)"
        >
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <component :is="getIcon(vehicle.type)" class="size-5 text-foreground/50" />
          </div>
          <div class="flex-1 min-w-0">
            <span class="text-sm font-medium truncate text-muted-foreground">
              {{ vehicle.name || VEHICLE_TYPE_LABELS[vehicle.type as VehicleType] || vehicle.type }}
            </span>
            <div class="flex items-center gap-1 mt-0.5">
              <MapPinOffIcon class="size-3 text-muted-foreground/60" />
              <span class="text-xs text-muted-foreground/60">No location set</span>
            </div>
          </div>
        </Card>
      </template>
    </div>
  </PanelLayout>
</template>
