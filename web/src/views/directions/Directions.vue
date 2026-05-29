<script setup lang="ts">
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import { computed, onUnmounted } from 'vue'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDirectionsService } from '@/services/directions.service'
import { useMapListener } from '@/composables/useMapListener'
import {
  AccessibilityIcon,
  BikeIcon,
  BusFrontIcon,
  CarFrontIcon,
  ClockIcon,
  FootprintsIcon,
  ShuffleIcon,
  SlidersHorizontalIcon,
  TrainFrontIcon,
  TrainIcon,
  XIcon,
} from 'lucide-vue-next'
import { useDirectionsStore } from '@/stores/directions.store'
import { storeToRefs } from 'pinia'
import WaypointInput from './WaypointInput.vue'
import TripsList from './TripsList.vue'
import RoutingPreferences from './RoutingPreferences.vue'
import { Spinner } from '@/components/ui/spinner'
import { Waypoint } from '@/types/map.types'
import { SelectedMode, SortPreference } from '@/types/multimodal.types'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { AppRoute } from '@/router'

dayjs.extend(duration)

const directionsService = useDirectionsService()
const directionsStore = useDirectionsStore()

const { waypoints, trips, selectedMode, departureTime, sortPreference, isLoading, timezoneWarning } =
  storeToRefs(directionsStore)

const showPreferences = ref(false)

// ── Sort preference ──────────────────────────────────────────────
const sortOptions: Array<{ value: SortPreference | 'recommended'; label: string }> = [
  { value: 'recommended', label: 'Balanced' },
  { value: 'shortest', label: 'Shortest' },
  { value: 'earliest_arrival', label: 'Earliest arrival' },
  { value: 'cheapest', label: 'Cheapest' },
  { value: 'fewest_transfers', label: 'Fewest transfers' },
  { value: 'least_walking', label: 'Least walking' },
  { value: 'greenest', label: 'Greenest' },
]

const selectedSort = computed({
  get: () => sortPreference.value || 'recommended',
  set: (val: string) => {
    sortPreference.value = val === 'recommended' ? null : val as SortPreference
  },
})

// ── Departure time controls ───────────────────────────────────────
const showTimePicker = ref(false)

/** Format the departure time for the datetime-local input */
const departureTimeLocal = computed({
  get: () => {
    if (!departureTime.value) return ''
    return dayjs(departureTime.value).format('YYYY-MM-DDTHH:mm')
  },
  set: (val: string) => {
    if (!val) {
      departureTime.value = null
      return
    }
    departureTime.value = new Date(val).toISOString()
  },
})

const departureTimeLabel = computed(() => {
  if (!departureTime.value) return 'Now'
  const d = dayjs(departureTime.value)
  const today = dayjs()
  if (d.isSame(today, 'day')) return `Depart ${d.format('h:mm A')}`
  return `Depart ${d.format('MMM D, h:mm A')}`
})

function clearDepartureTime() {
  departureTime.value = null
  showTimePicker.value = false
}

onBeforeRouteLeave(to => {
  // Keep trips alive when drilling into a trip detail — TripDetail needs them.
  if (to.name === AppRoute.TRIP) return
  directionsService.clearWaypoints()
  directionsStore.unsetTrips()
})

const modes: Array<{ type: SelectedMode; icon: any; label: string }> = [
  {
    type: 'multi',
    icon: ShuffleIcon,
    label: 'All modes',
  },
  {
    type: 'walking',
    icon: FootprintsIcon,
    label: 'Walking',
  },
  {
    type: 'biking',
    icon: BikeIcon,
    label: 'Cycling',
  },
  {
    type: 'transit',
    icon: TrainIcon,
    label: 'Transit',
  },
  {
    type: 'driving',
    icon: CarFrontIcon,
    label: 'Driving',
  },
  {
    type: 'wheelchair',
    icon: AccessibilityIcon,
    label: 'Wheelchair',
  },
]

// Override default click behavior to add waypoints instead of navigating
useMapListener(
  'click',
  data => {
    directionsService.fillWaypoint({
      lngLat: data.lngLat,
      place:
        data.poi && data.poi.name
          ? {
              id: `${data.poi.poiType}/${data.poi.osmId}`,
              name: {
                value: data.poi.name,
                sourceId: 'osm',
              },
              placeType: {
                value: 'poi',
                sourceId: 'osm',
              },
              geometry: {
                value: {
                  type: 'point',
                  center: data.lngLat,
                },
                sourceId: 'osm',
              },
            }
          : undefined,
    })
  },
  { override: true },
)
</script>

<template>
  <PanelLayout>
    <div class="space-y-3 flex flex-col">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold">Directions</h1>
        <ResponsivePopover
          v-model:open="showPreferences"
          side="top"
          :side-offset="-48"
          align="end"
          :align-offset="8"
          desktop-content-class="w-[24.5rem] p-0"
          mobile-content-class="px-2"
        >
          <template #trigger>
            <Button
              variant="ghost"
              size="icon"
              class="shrink-0"
              :class="showPreferences && 'bg-accent'"
              title="Route preferences"
            >
              <SlidersHorizontalIcon class="size-4" />
            </Button>
          </template>

          <template #content="{ close }">
            <RoutingPreferences
              :selected-mode="selectedMode"
              @close="close"
            />
          </template>
        </ResponsivePopover>
      </div>
      <Tabs v-model="selectedMode">
        <TabsList class="w-full flex">
          <TabsTrigger
            v-for="(mode, i) in modes"
            :key="i"
            :value="mode.type"
            class="grow"
            :title="mode.label"
          >
            <component :is="mode.icon" class="size-5" />
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <WaypointInput
        :model-value="waypoints"
        @update:modelValue="directionsService.setWaypoints"
      />

      <!-- Departure time + sort preference -->
      <div class="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          class="h-7 text-xs gap-1.5 font-normal"
          :class="departureTime ? 'pr-1' : ''"
          @click="showTimePicker = !showTimePicker"
        >
          <ClockIcon class="size-3.5" />
          {{ departureTimeLabel }}
          <span
            v-if="departureTime"
            class="ml-0.5 p-0.5 rounded hover:bg-muted"
            @click.stop="clearDepartureTime"
          >
            <XIcon class="size-3" />
          </span>
        </Button>

        <div class="flex-1" />

        <Select v-model="selectedSort">
          <SelectTrigger class="h-7 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="opt in sortOptions"
              :key="opt.value"
              :value="opt.value"
              class="text-xs"
            >
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div v-if="showTimePicker" class="flex items-center gap-2">
        <input
          type="datetime-local"
          class="flex-1 h-8 px-2 text-xs rounded-md border border-input bg-background ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :value="departureTimeLocal"
          @input="(e: any) => departureTimeLocal = e.target.value"
        />
      </div>
    </div>

    <!-- Timezone warning -->
    <div
      v-if="timezoneWarning"
      class="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 rounded-md text-sm"
    >
      <ClockIcon class="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <span class="text-amber-800 dark:text-amber-200">
        Your destination is in a different time zone ({{ timezoneWarning.offsetDifferenceText }})
      </span>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <Spinner />
      <span class="ml-2 text-sm text-muted-foreground"> Finding trips... </span>
    </div>

    <!-- Trips results -->
    <TripsList v-else-if="trips" :trips="trips" class="flex-1" />

    <!-- No results -->
    <div
      v-else-if="!isLoading && waypoints.some(wp => wp.lngLat)"
      class="text-center py-8 text-muted-foreground"
    >
      <p class="text-sm">No routes found</p>
    </div>
  </PanelLayout>
</template>
