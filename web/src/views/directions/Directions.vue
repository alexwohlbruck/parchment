<script setup lang="ts">
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import { computed, onUnmounted, onMounted, inject, type Ref } from 'vue'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDirectionsService } from '@/services/directions.service'
import { useMapListener } from '@/composables/map/useMapListener'
import {
  BusFrontIcon,
  ChartNoAxesGanttIcon,
  ClockIcon,
  ListIcon,
  ListFilterIcon,
  SlidersHorizontalIcon,
  RefreshCwIcon,
  TrainFrontIcon,
  XIcon,
} from 'lucide-vue-next'
import { useDirectionsStore, RIDESHARE_ENABLED } from '@/stores/directions.store'
import { storeToRefs } from 'pinia'
import WaypointInput from '@/components/directions/WaypointInput.vue'
import TripsList from '@/components/directions/TripsList.vue'
import TripList from '@/components/directions/TripList.vue'
import RoutingPreferences from '@/components/directions/preferences/RoutingPreferences.vue'
import TripModeToggles from '@/components/directions/preferences/TripModeToggles.vue'
import TripSortSelect from '@/components/directions/preferences/TripSortSelect.vue'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import type { TripSort } from '@/lib/preferences/navigation-preferences'
import DirectionsLoading from '@/components/directions/DirectionsLoading.vue'
import TravelTimeLabel from '@/components/directions/TravelTimeLabel.vue'
import { MODE_ICONS } from '@/components/directions/mode-icons'
import { usePremiumNavigation } from '@/composables/usePremiumNavigation'
import { useModeTravelTimes } from '@/composables/directions/useModeTravelTimes'
import { useElementSize } from '@vueuse/core'
import { useSheetPeek } from '@/composables/sheet/useSheetPeek'
import { Waypoint } from '@/types/map.types'
import { SelectedMode } from '@/types/multimodal.types'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { AppRoute } from '@/router'
import { freeModeFor } from '@/lib/guidance/free-roam'
import { useStartFreeRoam } from '@/composables/guidance/useStartFreeRoam'
import { FREE_MODE_ICONS } from '@/components/guidance/free-mode-icons'

dayjs.extend(duration)

const route = useRoute()
const { t } = useI18n()
const startFreeRoam = useStartFreeRoam()
const directionsService = useDirectionsService()
const directionsStore = useDirectionsStore()

const { waypoints, trips, selectedMode, departureTime, sortPreference, effectiveSort, tripView, isLoading, timezoneWarning } =
  storeToRefs(directionsStore)
const navigationPreferences = useNavigationPreferencesStore()

const travelTimes = useModeTravelTimes()
const premiumNavigation = usePremiumNavigation()
const showTravelTimes = computed(() => premiumNavigation.value && waypoints.value.filter(wp => wp.lngLat).length >= 2)

const refreshing = ref(false)

async function refresh() {
  refreshing.value = true
  try {
    await directionsService.replan()
  } finally {
    refreshing.value = false
  }
}

function toggleTripView() {
  tripView.value = tripView.value === 'timeline' ? 'list' : 'timeline'
}

const showPreferences = ref(false)
const showModeFilter = ref(false)
const modesFiltered = computed(() => navigationPreferences.excludedModes.length > 0)

// The waypoint/options/sort controls stay pinned while results scroll under
// them. This element is also the dynamic-peek anchor: on mobile the sheet
// sizes its peek detent to fit down to its bottom, so peek shows just the
// inputs (no trip results). The sheet only measures it while unscrolled, so
// the sticky pinning never skews the measurement. useSheetPeek no-ops on
// desktop (no sheet provider).
const { peekRef } = useSheetPeek()
// Measure the border-box (includes padding) so the time axis docks flush
// below the controls — content-box would leave the axis tucked ~24px behind
// them, hiding the time labels.
const { height: controlsHeight } = useElementSize(peekRef, undefined, {
  box: 'border-box',
})

// On mobile, opt the host sheet into its opaque chrome bar — the pinned
// inputs need to clear the drag handle / close button, and the suggestions
// must scroll cleanly beneath them. No-op on desktop (no sheet provider).
const sheetChromeBar = inject<Ref<boolean> | null>('sheetChromeBar', null)
onMounted(() => {
  if (sheetChromeBar) sheetChromeBar.value = true
  directionsService.refreshCurrentLocation()
})
onUnmounted(() => {
  if (sheetChromeBar) sheetChromeBar.value = false
})

const selectedSort = computed({
  get: () => effectiveSort.value,
  set: (sort: TripSort) => {
    const fallback = navigationPreferences.sortPreference ?? 'balanced'
    sortPreference.value = sort === fallback ? null : sort
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

// Tear down on unmount rather than in onBeforeRouteLeave: the leave guard runs
// mid-navigation while the route is still /directions, so clearing waypoints
// there fires the service's syncUrl watcher, which issues a router.replace
// (?mode=…) that cancels the outgoing close navigation and traps the drawer
// open until a second click. By onUnmounted the route has committed, so syncUrl
// bails on its /directions path guard. `route.name` is the committed
// destination here — skip clearing when drilling into a trip detail.
onUnmounted(() => {
  // Keep trips alive when drilling into a trip detail — TripDetail needs them.
  if (route.name === AppRoute.TRIP) return
  directionsService.clearTrip()
})

const allModes: Array<{ type: SelectedMode; icon: any; label: string }> = [
  {
    type: 'multi',
    icon: MODE_ICONS.multi,
    label: 'All modes',
  },
  {
    type: 'walking',
    icon: MODE_ICONS.walking,
    label: 'Walking',
  },
  {
    type: 'biking',
    icon: MODE_ICONS.biking,
    label: 'Cycling',
  },
  {
    type: 'transit',
    icon: MODE_ICONS.transit,
    label: 'Transit',
  },
  {
    type: 'driving',
    icon: MODE_ICONS.driving,
    label: 'Driving',
  },
  {
    type: 'rideshare',
    icon: MODE_ICONS.rideshare,
    label: 'Rideshare',
  },
]

const modes = allModes.filter(
  m => m.type !== 'rideshare' || RIDESHARE_ENABLED,
)

// From here with nowhere chosen yet, navigation can start without a destination.
const freeRoamMode = computed(() => {
  const [origin, ...rest] = waypoints.value
  if (origin?.place?.id !== 'current-location' || rest.some(wp => wp.lngLat)) return null
  return freeModeFor(selectedMode.value === 'multi' ? 'driving' : selectedMode.value)
})

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
        <TabsList class="w-full flex" :class="showTravelTimes && 'h-auto'">
          <TabsTrigger
            v-for="(mode, i) in modes"
            :key="i"
            :value="mode.type"
            class="grow basis-0 min-w-0"
            :class="[
              showTravelTimes && 'flex-col gap-1 px-1 py-1.5',
              travelTimes[mode.type]?.state === 'none' && 'opacity-40',
            ]"
            :title="mode.label"
          >
            <component :is="mode.icon" class="size-5" />
            <TravelTimeLabel v-if="showTravelTimes" :time="travelTimes[mode.type] ?? { state: 'unknown' }" />
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>

    <!-- Pinned controls — pin to the top of the host scroll surface (which on
         mobile sits just below the sheet's opaque chrome bar). pt-3 keeps the
         inputs off the chrome; the full-bleed background fades in from the top
         so content scrolling underneath dissolves rather than clipping. -->
    <div
      ref="peekRef"
      class="sticky z-30 -mx-3 px-3 pt-3 pb-3 space-y-3 bg-gradient-to-b from-background/0 to-background"
      :style="{ top: 'var(--sheet-sticky-top, 0px)' }"
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
            class="ml-0.5 p-0.5 rounded hover:bg-muted cursor-pointer"
            @click.stop="clearDepartureTime"
          >
            <XIcon class="size-3" />
          </span>
        </Button>

        <div class="flex-1" />

        <ResponsivePopover
          v-if="selectedMode === 'multi'"
          v-model:open="showModeFilter"
          side="bottom"
          :side-offset="6"
          align="end"
          desktop-content-class="w-60 p-4"
          mobile-content-class="px-4 pb-4"
          fit-content
        >
          <template #trigger>
            <Button
              variant="outline"
              size="sm"
              class="relative h-7 w-7 p-0 shrink-0"
              :class="showModeFilter && 'bg-accent'"
              :title="t('directions.tripModes.filter')"
            >
              <ListFilterIcon class="size-3.5" />
              <span
                v-if="modesFiltered"
                class="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
              />
            </Button>
          </template>

          <template #content>
            <TripModeToggles />
          </template>
        </ResponsivePopover>

        <TripSortSelect
          v-model="selectedSort"
          trigger-class="h-7 w-[150px] text-xs"
          item-class="text-xs"
        />

        <Button
          variant="outline"
          size="sm"
          class="h-7 w-7 p-0 shrink-0"
          :title="tripView === 'timeline' ? 'Show as a list' : 'Show as a timeline'"
          @click="toggleTripView"
        >
          <ListIcon v-if="tripView === 'timeline'" class="size-3.5" />
          <ChartNoAxesGanttIcon v-else class="size-3.5" />
        </Button>

        <Button
          v-if="trips"
          variant="outline"
          size="sm"
          class="h-7 w-7 p-0 shrink-0"
          :title="t('directions.refresh')"
          :disabled="refreshing"
          @click="refresh"
        >
          <RefreshCwIcon class="size-3.5" :class="refreshing && 'animate-spin'" />
        </Button>

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
            <RoutingPreferences :selected-mode="selectedMode" />
            <div class="hidden md:flex justify-end px-4 py-3 border-t">
              <Button size="sm" @click="close">
                {{ t('general.done') }}
              </Button>
            </div>
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
        {{ t('directions.timezoneOffset', { offset: timezoneWarning.offsetDifferenceText }) }}
      </span>
    </div>

    <!-- Loading — centered in the open space below the inputs -->
    <div
      v-if="isLoading"
      class="flex items-center justify-center min-h-[55dvh]"
    >
      <DirectionsLoading />
    </div>

    <!-- Trips results — the time-scaled timeline, or a plain list -->
    <template v-else-if="trips">
      <TripsList
        v-if="tripView === 'timeline'"
        :trips="trips"
        :sticky-top="controlsHeight"
        class="-mx-3"
      />
      <TripList v-else :trips="trips" class="-mx-3" />
    </template>

    <div v-else-if="freeRoamMode" class="flex min-h-[30dvh] items-center justify-center">
      <Button variant="secondary" class="rounded-full" @click="startFreeRoam(freeRoamMode)">
        <component :is="FREE_MODE_ICONS[freeRoamMode]" class="mr-2 size-4" />
        {{ t(`guidance.free.withoutDestination.${freeRoamMode}`) }}
      </Button>
    </div>

    <!-- No results -->
    <div
      v-else-if="waypoints.some(wp => wp.lngLat)"
      class="flex items-center justify-center min-h-[40dvh] text-center text-muted-foreground"
    >
      <p class="text-sm">No routes found</p>
    </div>
  </PanelLayout>
</template>
