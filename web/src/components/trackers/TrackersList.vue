<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { useVehicleLocationPicker } from '@/composables/useVehicleLocationPicker'
import { useMapService } from '@/services/map.service'
import { VEHICLE_TYPE_LABELS } from '@/lib/vehicle-mode-mapping'
import type { UserVehicle, VehicleType } from '@/types/multimodal.types'
import { AppRoute } from '@/router'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  CarFrontIcon,
  BikeIcon,
  TruckIcon,
  AccessibilityIcon,
  MapPinIcon,
  MapPinOffIcon,
  MoreVerticalIcon,
  CrosshairIcon,
  NavigationIcon,
  CheckIcon,
  SettingsIcon,
  type LucideIcon,
} from 'lucide-vue-next'

const router = useRouter()
const vehiclesStore = useVehiclesStore()
const mapService = useMapService()
const { startPicking } = useVehicleLocationPicker()
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

const isLocationFresh = (vehicle: UserVehicle) => {
  const staleness = vehiclesStore.getLocationStaleness(vehicle)
  return staleness === 'fresh' || staleness === 'aging'
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

function handleSetLocation(vehicle: UserVehicle) {
  startPicking(vehicle.id, '/lookout')
}

function handleCenterOnMap(vehicle: UserVehicle) {
  if (!vehicle.lastKnownLocation) return
  mapService.flyTo({
    center: [vehicle.lastKnownLocation.lng, vehicle.lastKnownLocation.lat],
    zoom: 15,
  })
}

async function handleActivate(vehicle: UserVehicle) {
  await vehiclesStore.setActiveVehicle(vehicle.id)
}

function goToSettings() {
  router.push({ name: AppRoute.VEHICLES })
}
</script>

<template>
  <!-- Empty state -->
  <div v-if="!loading && vehicles.length === 0" class="py-8 text-center">
    <MapPinIcon class="mx-auto mb-3 size-10 text-muted-foreground/50" />
    <p class="text-sm text-muted-foreground mb-3">
      No trackers yet. Add vehicles in settings to track their locations on the map.
    </p>
    <Button variant="outline" size="sm" @click="goToSettings">
      <SettingsIcon class="size-4 mr-1.5" />
      Add vehicles
    </Button>
  </div>

  <!-- Tracker list -->
  <div v-else class="space-y-1">
    <template v-if="trackedVehicles.length">
      <Card
        v-for="vehicle in trackedVehicles"
        :key="vehicle.id"
        class="overflow-hidden"
      >
        <div
          class="px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors"
          @click="openDetail(vehicle)"
        >
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground">
            <component :is="getIcon(vehicle.type)" class="size-5 text-background" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold truncate leading-tight">
              {{ vehicle.name || VEHICLE_TYPE_LABELS[vehicle.type as VehicleType] || vehicle.type }}
            </p>
            <p class="text-xs text-muted-foreground truncate leading-tight">
              {{ VEHICLE_TYPE_LABELS[vehicle.type as VehicleType] || vehicle.type }}
              <template v-if="vehicle.energyType"> &middot; {{ vehicle.energyType }}</template>
            </p>
            <div class="flex items-center gap-1.5 mt-0.5">
              <div
                class="size-1.5 rounded-full shrink-0"
                :class="isLocationFresh(vehicle) ? 'bg-forest-500' : 'bg-muted-foreground/50'"
              />
              <span class="text-[11px] text-muted-foreground truncate">
                {{ getLocationLabel(vehicle) }}
              </span>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                class="size-7 shrink-0"
                @click.stop
              >
                <MoreVerticalIcon class="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="handleCenterOnMap(vehicle)" :disabled="!vehicle.lastKnownLocation">
                <NavigationIcon class="size-4" />
                Show on map
              </DropdownMenuItem>
              <DropdownMenuItem @click="handleSetLocation(vehicle)">
                <CrosshairIcon class="size-4" />
                Set location
              </DropdownMenuItem>
              <DropdownMenuItem v-if="!vehicle.isActive" @click="handleActivate(vehicle)">
                <CheckIcon class="size-4" />
                Set as active
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem @click="goToSettings">
                <SettingsIcon class="size-4" />
                Manage vehicles
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>
    </template>

    <template v-if="untrackedVehicles.length">
      <p v-if="trackedVehicles.length" class="text-xs font-medium text-muted-foreground mt-4 mb-1.5 px-1">No location</p>
      <Card
        v-for="vehicle in untrackedVehicles"
        :key="vehicle.id"
        class="overflow-hidden"
      >
        <div
          class="px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors"
          @click="openDetail(vehicle)"
        >
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <component :is="getIcon(vehicle.type)" class="size-5 text-muted-foreground" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold truncate leading-tight text-muted-foreground">
              {{ vehicle.name || VEHICLE_TYPE_LABELS[vehicle.type as VehicleType] || vehicle.type }}
            </p>
            <div class="flex items-center gap-1.5 mt-0.5">
              <MapPinOffIcon class="size-3 text-muted-foreground/60" />
              <span class="text-[11px] text-muted-foreground/60">No location set</span>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                class="size-7 shrink-0"
                @click.stop
              >
                <MoreVerticalIcon class="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="handleSetLocation(vehicle)">
                <CrosshairIcon class="size-4" />
                Set location
              </DropdownMenuItem>
              <DropdownMenuItem v-if="!vehicle.isActive" @click="handleActivate(vehicle)">
                <CheckIcon class="size-4" />
                Set as active
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem @click="goToSettings">
                <SettingsIcon class="size-4" />
                Manage vehicles
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>
    </template>
  </div>
</template>
