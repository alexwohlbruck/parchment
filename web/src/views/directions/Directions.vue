<script setup lang="ts">
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import { computed, onUnmounted, onMounted, inject, type Ref } from 'vue'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDirectionsService } from '@/services/directions.service'
import { useMapListener } from '@/composables/useMapListener'
import {
  AccessibilityIcon,
  BikeIcon,
  BusFrontIcon,
  CarFrontIcon,
  CarTaxiFrontIcon,
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
import DirectionsLoading from './DirectionsLoading.vue'
import { useElementSize } from '@vueuse/core'
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

// The waypoint/options/sort controls stay pinned while results scroll under
// them. Measure their height so the timeline's time-axis header can dock
// directly below the pinned controls instead of overlapping them.
const controlsRef = ref<HTMLElement | null>(null)
// Measure the border-box (includes padding) so the time axis docks flush
// below the controls — content-box would leave the axis tucked ~24px behind
// them, hiding the time labels.
const { height: controlsHeight } = useElementSize(controlsRef, undefined, {
  box: 'border-box',
})

// On mobile, opt the host sheet into its opaque chrome bar — the pinned
// inputs need to clear the drag handle / close button, and the suggestions
// must scroll cleanly beneath them. No-op on desktop (no sheet provider).
const sheetChromeBar = inject<Ref<boolean> | null>('sheetChromeBar', null)
onMounted(() => {
  if (sheetChromeBar) sheetChromeBar.value = true
})
onUnmounted(() => {
  if (sheetChromeBar) sheetChromeBar.value = false
})

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
    type: 'rideshare',
    icon: CarTaxiFrontIcon,
    label: 'Rideshare',
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
    <!-- The host sheet owns the one scroll surface (LeftSheet Card on
         desktop, BottomSheet's data-sheet-scroll on mobile); this view just
         flows content into it. A nested overflow container is what broke
         scrolling inside the mobile sheet. Title + mode tabs scroll away;
         the controls and the timeline axis pin with `position: sticky`,
         docking below the sheet's own chrome via `--sheet-sticky-top`. -->

    <!-- Collapsing header — title + tabs scroll up and out of view. -->
    <div class="space-y-3">
      <h1 class="text-2xl font-semibold">Directions</h1>
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
    </div>

    <!-- Pinned controls — pin to the top of the host scroll surface (which on
         mobile sits just below the sheet's opaque chrome bar). pt-3 keeps the
         inputs off the chrome; the full-bleed background covers suggestions
         scrolling underneath. -->
    <div
      ref="controlsRef"
      class="sticky top-0 z-30 -mx-3 px-3 pt-3 pb-3 space-y-3 bg-background"
    >
      <WaypointInput
        :model-value="waypoints"
        @update:modelValue="directionsService.setWaypoints"
      />

      <!-- Departure time + sort + preferences -->
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

        <ResponsivePopover
          v-model:open="showPreferences"
          side="bottom"
          :side-offset="6"
          align="end"
          desktop-content-class="w-[24.5rem] p-0"
          mobile-content-class="px-2"
        >
          <template #trigger>
            <Button
              variant="outline"
              size="sm"
              class="h-7 w-7 p-0 shrink-0"
              :class="showPreferences && 'bg-accent'"
              title="Route preferences"
            >
              <SlidersHorizontalIcon class="size-3.5" />
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
      class="mb-2 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 rounded-md text-sm"
    >
      <ClockIcon class="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <span class="text-amber-800 dark:text-amber-200">
        Your destination is in a different time zone ({{ timezoneWarning.offsetDifferenceText }})
      </span>
    </div>

    <!-- Loading — centered in the open space below the inputs -->
    <div
      v-if="isLoading"
      class="flex items-center justify-center min-h-[55dvh]"
    >
      <DirectionsLoading />
    </div>

    <!-- Trips results (full-bleed timeline) -->
    <TripsList
      v-else-if="trips"
      :trips="trips"
      :sticky-top="controlsHeight"
      class="-mx-3"
    />

    <!-- No results -->
    <div
      v-else-if="waypoints.some(wp => wp.lngLat)"
      class="flex items-center justify-center min-h-[40dvh] text-center text-muted-foreground"
    >
      <p class="text-sm">No routes found</p>
    </div>
  </PanelLayout>
</template>
