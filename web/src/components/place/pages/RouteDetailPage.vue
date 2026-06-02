<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouteDetailStore, type DepartureContext } from '@/stores/route-detail.store'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import SheetPageHeader from '@/components/place/SheetPageHeader.vue'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'
import { useTransitClock } from '@/composables/useTransitClock'
import {
  formatDepartureTime,
  getMinutesUntil,
} from '@/lib/transit'
import {
  TrainFrontIcon,
  BusIcon,
  ShipIcon,
  TramFrontIcon,
  MapPinIcon,
  ChevronDownIcon,
  ClockIcon,
} from 'lucide-vue-next'
import type { TransitDeparture } from '@/types/place.types'

const props = defineProps<{
  feedId: string
  routeId: string
  originStopName?: string
  headsign?: string
  routeDepartures?: TransitDeparture[]
}>()

const routeDetailStore = useRouteDetailStore()
const currentTime = useTransitClock()

const route = computed(() => routeDetailStore.activeRoute)
const isLoading = computed(() => routeDetailStore.isLoading)
const vehicles = computed(() => routeDetailStore.vehicleList)
const originStopIndex = computed(() => routeDetailStore.originStopIndex)
const headway = computed(() => routeDetailStore.headwayMinutes)
const upcoming = computed(() => routeDetailStore.upcomingDepartures)

const displayName = computed(() => {
  if (!route.value) return ''
  return route.value.routeShortName || route.value.routeLongName || route.value.routeId
})

const fullName = computed(() => {
  if (!route.value) return ''
  return route.value.routeLongName || route.value.routeShortName || ''
})

const bgColor = computed(() =>
  route.value?.routeColor ? `#${route.value.routeColor}` : 'hsl(var(--foreground))',
)

const textColor = computed(() =>
  route.value?.routeTextColor ? `#${route.value.routeTextColor}` : 'hsl(var(--background))',
)

const routeTypeIcon = computed(() => {
  switch (route.value?.routeType) {
    case 0: return TramFrontIcon
    case 1: return TrainFrontIcon
    case 2: return TrainFrontIcon
    case 3: return BusIcon
    case 4: return ShipIcon
    default: return BusIcon
  }
})

const routeTypeLabel = computed(() => {
  switch (route.value?.routeType) {
    case 0: return 'Tram'
    case 1: return 'Subway'
    case 2: return 'Rail'
    case 3: return 'Bus'
    case 4: return 'Ferry'
    default: return 'Transit'
  }
})

/** First upcoming departure for the "Now" / "X min" display. */
const nextDeparture = computed(() => upcoming.value[0] ?? null)

const nextDepartureMinutes = computed(() => {
  if (!nextDeparture.value) return null
  return getMinutesUntil(nextDeparture.value, currentTime.value)
})

const nextDepartureLabel = computed(() => {
  const m = nextDepartureMinutes.value
  if (m === null) return null
  if (m <= 0) return 'Now'
  if (m === 1) return '1 min'
  return `${m} min`
})

const delayStatus = computed(() => {
  if (!nextDeparture.value) return null
  const delay = nextDeparture.value.delay
  if (delay == null) return null
  if (delay <= 60) return 'On-time'
  const mins = Math.round(delay / 60)
  return `${mins} min late`
})

/** Is a stop "before" the current origin stop? */
function isBeforeOrigin(index: number): boolean {
  if (originStopIndex.value < 0) return false
  return index < originStopIndex.value
}

function isOriginStop(index: number): boolean {
  return originStopIndex.value >= 0 && index === originStopIndex.value
}

onMounted(() => {
  const context: DepartureContext | undefined = props.originStopName
    ? {
        originStopName: props.originStopName,
        headsign: props.headsign || '',
        departures: props.routeDepartures || [],
      }
    : undefined
  routeDetailStore.openRoute(props.feedId, props.routeId, context)
})

onUnmounted(() => {
  routeDetailStore.closeRoute()
})
</script>

<template>
  <PanelLayout>
    <SheetPageHeader :title="displayName || 'Route'" />

    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <div class="animate-spin h-6 w-6 border-2 border-foreground/20 border-t-foreground rounded-full" />
    </div>

    <div v-else-if="route" class="flex flex-col pb-6">
      <!-- ── Route header ──────────────────────────────────── -->
      <div class="flex items-start gap-3 px-4 mb-4">
        <div
          class="flex items-center justify-center min-w-10 h-10 px-2.5 rounded-lg font-bold text-lg shrink-0"
          :style="{ background: bgColor, color: textColor }"
        >
          {{ route.routeShortName || '' }}
        </div>
        <div class="flex flex-col min-w-0 pt-0.5">
          <span class="font-semibold text-base leading-tight">
            {{ fullName }}
          </span>
          <span v-if="headsign" class="text-sm text-muted-foreground">
            {{ headsign }}
          </span>
        </div>
      </div>

      <!-- ── Departures summary ────────────────────────────── -->
      <div v-if="upcoming.length > 0" class="px-4 mb-4">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-sm font-semibold">Departures</span>
          <span v-if="headway" class="text-xs text-muted-foreground">
            Every {{ headway }} min
          </span>
        </div>

        <div class="flex items-center gap-2 text-sm">
          <span
            :class="[
              'font-medium',
              nextDepartureMinutes != null && nextDepartureMinutes <= 1
                ? 'text-green-600 dark:text-green-400'
                : '',
            ]"
          >
            {{ nextDepartureLabel || '—' }}
          </span>
          <template v-if="delayStatus">
            <span class="text-muted-foreground">·</span>
            <span
              :class="[
                'text-xs',
                delayStatus === 'On-time'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-orange-500',
              ]"
            >
              {{ delayStatus }}
            </span>
          </template>
        </div>

        <!-- Next few departures -->
        <div v-if="upcoming.length > 1" class="flex items-center gap-2 mt-1.5 flex-wrap">
          <template v-for="(dep, i) in upcoming.slice(0, 4)" :key="i">
            <span class="text-xs text-muted-foreground tabular-nums">
              {{ formatDepartureTime(dep) }}
            </span>
            <span v-if="dep.realTime" class="inline-flex">
              <RealtimeIndicator :realTime="true" />
            </span>
          </template>
        </div>
      </div>

      <!-- ── Live vehicles ─────────────────────────────────── -->
      <div
        v-if="vehicles.length > 0"
        class="flex items-center gap-2 px-4 py-2 mx-4 mb-4 rounded-lg bg-muted/50"
      >
        <component :is="routeTypeIcon" class="h-4 w-4 text-muted-foreground shrink-0" />
        <span class="text-sm text-muted-foreground">
          {{ vehicles.length }} {{ routeTypeLabel.toLowerCase() }}{{ vehicles.length !== 1 ? 's' : '' }} active
        </span>
      </div>

      <!-- ── Stops ─────────────────────────────────────────── -->
      <div class="px-4">
        <div class="text-sm font-semibold mb-3">Stops</div>

        <div class="relative pl-7">
          <!-- Route color line -->
          <div
            class="absolute left-[11px] top-2 bottom-2 w-[3px] rounded-full"
            :style="{ background: bgColor }"
          />

          <div
            v-for="(stop, i) in route.stops"
            :key="stop.stopId"
            class="relative flex items-center justify-between gap-2 min-h-[32px]"
            :class="{
              'opacity-40': isBeforeOrigin(i),
            }"
          >
            <!-- Stop marker -->
            <div
              class="absolute w-[9px] h-[9px] rounded-full border-2 bg-background z-10"
              :style="{ borderColor: bgColor }"
              :class="[
                i === 0 || i === route.stops.length - 1
                  ? 'w-[11px] h-[11px] -left-[16px] top-[11px]'
                  : '-left-[15px] top-[12px]',
                isOriginStop(i) ? 'w-[11px] h-[11px] -left-[16px] top-[11px]' : '',
              ]"
            />

            <!-- Active stop vehicle icon -->
            <div
              v-if="isOriginStop(i)"
              class="absolute -left-[22px] top-[5px] w-[23px] h-[23px] rounded-full flex items-center justify-center z-20"
              :style="{ background: bgColor }"
            >
              <component
                :is="routeTypeIcon"
                class="h-3.5 w-3.5"
                :style="{ color: textColor }"
              />
            </div>

            <!-- Stop name -->
            <span
              class="text-sm leading-snug py-1.5"
              :class="{
                'font-semibold': i === 0 || i === route.stops.length - 1 || isOriginStop(i),
              }"
            >
              {{ stop.stopName }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <MapPinIcon class="h-8 w-8 mb-2 opacity-50" />
      <span class="text-sm">Route not found</span>
    </div>
  </PanelLayout>
</template>
