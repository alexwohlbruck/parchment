<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import dayjs from 'dayjs'
import { useRouter } from 'vue-router'
import type { TripsResponse, TripOption } from '@/types/directions.types'
import TripItem from './TripItem.vue'
import { useDirectionsStore } from '@/stores/directions.store'
import { serializeDirectionsQuery } from '@/lib/directions-url'
import { tripSignature } from '@/lib/trip-signature'
import { api } from '@/lib/api'

interface Props {
  trips: TripsResponse
  /** Height (px) of the pinned controls above; the time axis docks below it. */
  stickyTop?: number
}

const props = withDefaults(defineProps<Props>(), {
  stickyTop: 0,
})
const router = useRouter()
const directionsStore = useDirectionsStore()

const MIN_PX_PER_MIN = 1.5
const MAX_PX_PER_MIN = 50

const containerRef = ref<HTMLElement | null>(null)
const containerWidth = ref(360)
const sidebarWidth = ref(0)

let observer: ResizeObserver | null = null

function updateWidth() {
  if (containerRef.value) {
    containerWidth.value = containerRef.value.clientWidth
    const sidebars = containerRef.value.querySelectorAll('[data-sidebar]')
    let maxW = 0
    sidebars.forEach(el => {
      maxW = Math.max(maxW, (el as HTMLElement).scrollWidth)
    })
    if (maxW > 0) sidebarWidth.value = maxW
  }
}

onMounted(() => {
  nextTick(() => updateWidth())
  observer = new ResizeObserver(updateWidth)
  if (containerRef.value) observer.observe(containerRef.value)
})

watch(() => props.trips, () => {
  sidebarWidth.value = 0
  nextTick(() => updateWidth())
})

onUnmounted(() => {
  observer?.disconnect()
})

const sortedTrips = computed(() => {
  return [...props.trips.trips].sort((a, b) => a.rank - b.rank)
})

const actualStart = computed(() => {
  const starts = props.trips.trips.flatMap(t => t.segments.map(s => new Date(s.startTime).getTime()))
  const apiStart = new Date(props.trips.earliestStart).getTime()
  return new Date(Math.min(apiStart, ...starts))
})

const actualEnd = computed(() => {
  const ends = props.trips.trips.flatMap(t => t.segments.map(s => new Date(s.endTime ?? new Date(s.startTime).getTime() + s.duration * 1000).getTime()))
  const apiEnd = new Date(props.trips.latestEnd).getTime()
  return new Date(Math.max(apiEnd, ...ends))
})

const timelineStart = computed(() => dayjs(actualStart.value))
const dataMinutes = computed(() => Math.max(dayjs(actualEnd.value).diff(timelineStart.value, 'minute', true), 1))

const barAreaWidth = computed(() => containerWidth.value - sidebarWidth.value)

const fitMinutes = computed(() => {
  const durations = sortedTrips.value
    .map(t => t.summary.totalDuration / 60)
    .sort((a, b) => a - b)

  if (durations.length <= 1) return dataMinutes.value

  const longest = durations[durations.length - 1]
  const secondLongest = durations[durations.length - 2]

  if (longest / Math.max(secondLongest, 0.5) > 2) {
    return Math.min(secondLongest * 1.3, dataMinutes.value)
  }

  return dataMinutes.value
})

const pxPerMinute = computed(() => {
  const target = fitMinutes.value + Math.max(2, fitMinutes.value * 0.1)
  const ideal = barAreaWidth.value / target
  return Math.max(MIN_PX_PER_MIN, Math.min(MAX_PX_PER_MIN, ideal))
})

const timelineWidth = computed(() => {
  const fullRange = dataMinutes.value + Math.max(2, dataMinutes.value * 0.1)
  return fullRange * pxPerMinute.value
})

const tickIntervals = computed(() => {
  const viewMin = barAreaWidth.value / pxPerMinute.value
  if (viewMin <= 2) return { tickSec: 10, labelSec: 30 }
  if (viewMin <= 4) return { tickSec: 15, labelSec: 60 }
  if (viewMin <= 8) return { tickSec: 30, labelSec: 60 }
  if (viewMin <= 15) return { tick: 1, label: 2 }
  if (viewMin <= 30) return { tick: 2, label: 5 }
  if (viewMin <= 60) return { tick: 5, label: 10 }
  if (viewMin <= 180) return { tick: 15, label: 30 }
  return { tick: 15, label: 60 }
})

const timeTicks = computed(() => {
  const result: Array<{ time: string; position: number; isLabel: boolean }> = []
  const intervals = tickIntervals.value
  const contentMinutes = timelineWidth.value / pxPerMinute.value
  const visibleMinutes = Math.max(contentMinutes, barAreaWidth.value / pxPerMinute.value)
  const endTime = timelineStart.value.add(visibleMinutes, 'minute')

  if ('tickSec' in intervals) {
    const { tickSec, labelSec } = intervals
    const startSec = timelineStart.value.startOf('minute')
    const firstOffset = Math.ceil(startSec.diff(timelineStart.value, 'second', true) / tickSec) * tickSec
    let current = startSec.add(firstOffset < 0 ? 0 : firstOffset, 'second')
    while (current.isBefore(timelineStart.value)) current = current.add(tickSec, 'second')

    while (current.isBefore(endTime) || current.isSame(endTime)) {
      const min = current.diff(timelineStart.value, 'second', true) / 60
      const totalSec = current.hour() * 3600 + current.minute() * 60 + current.second()
      const isLabel = totalSec % labelSec === 0
      const showSeconds = current.second() !== 0
      result.push({
        time: current.toDate().toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
          ...(showSeconds ? { second: '2-digit' } : {}),
        }),
        position: min * pxPerMinute.value,
        isLabel,
      })
      current = current.add(tickSec, 'second')
    }
  } else {
    const { tick, label } = intervals
    const startOfHour = dayjs(timelineStart.value).startOf('hour')
    const firstTickOffset = Math.ceil(startOfHour.diff(timelineStart.value, 'minute', true) / tick) * tick
    let current = startOfHour.add(firstTickOffset < 0 ? 0 : firstTickOffset, 'minute')
    while (current.isBefore(timelineStart.value)) current = current.add(tick, 'minute')

    while (current.isBefore(endTime) || current.isSame(endTime)) {
      const min = current.diff(timelineStart.value, 'minute', true)
      const totalMin = current.hour() * 60 + current.minute()
      result.push({
        time: current.toDate().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
        position: min * pxPerMinute.value,
        isLabel: totalMin % label === 0,
      })
      current = current.add(tick, 'minute')
    }
  }
  return result
})

function navigateToTripDetail(trip: TripOption) {
  // The trip URL carries the full planning inputs (same wp/mode/sort/depart
  // format as the directions URL) plus the trip's stable signature, so a
  // refresh or a shared link can re-plan and find this same trip again.
  const query = {
    ...serializeDirectionsQuery({
      waypoints: props.trips.request.waypoints.map((wp) => ({
        lat: wp.coordinate.lat,
        lng: wp.coordinate.lng,
        label: wp.name || undefined,
      })),
      mode: directionsStore.selectedMode,
      sort: directionsStore.sortPreference || undefined,
      depart: directionsStore.departureTime || undefined,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sig: tripSignature((trip as any).segments),
  }
  router.push({ name: 'trip', params: { id: trip.id }, query })

  // Persist a server-side snapshot in the background and slip its token
  // into the URL — the snapshot makes refresh and cross-device shares
  // exact, independent of schedule drift. Best-effort: the sig/re-plan
  // path still recovers the trip if this fails.
  api
    .post('/directions/trips', { request: query, trip })
    .then(({ data }) => {
      router
        .replace({
          name: 'trip',
          params: { id: trip.id },
          query: { ...query, pt: data.id },
        })
        .catch(() => {})
    })
    .catch(() => {})
}
</script>

<template>
  <!-- overflow-x-clip contains an over-long outlier bar without becoming a
       scroll container (which would capture the sticky axis and fight the
       sheet's single scroll surface). overflow-y stays visible so rows scroll
       in the host scroller. -->
  <div ref="containerRef" class="min-w-0 overflow-x-clip">
    <div :style="{ minWidth: `${timelineWidth + sidebarWidth}px` }">
      <!-- Time axis — opaque so suggestions are fully hidden as they scroll
           under it, docked just below the pinned controls. -->
      <!-- z above the trip caps (z-20) so rows are fully hidden under it, but
           below the pinned controls (z-30). -->
      <div
        class="sticky z-[25] pt-2 pb-1 border-b border-border/40 bg-background grid"
        :style="{
          gridTemplateColumns: 'auto 1fr',
          top: `calc(var(--sheet-sticky-top, 0px) + ${stickyTop}px)`,
        }"
      >
        <span :style="{ width: `${sidebarWidth}px` }" />
        <div class="relative h-7">
          <template v-for="tick in timeTicks" :key="tick.time">
            <div
              class="absolute bottom-0"
              :class="tick.isLabel ? 'h-2 border-l' : 'h-1.5 border-l border-border/60'"
              :style="{ left: `${tick.position}px` }"
            />
            <span
              v-if="tick.isLabel"
              class="absolute top-0 -translate-x-1/2 text-[10px] font-medium text-muted-foreground tabular-nums font-mono whitespace-nowrap -tracking-[0.02em]"
              :style="{ left: `${tick.position}px` }"
            >
              {{ tick.time }}
            </span>
          </template>
        </div>
      </div>

      <!-- Trip rows — staggered entrance as a fresh set of suggestions loads -->
      <TransitionGroup name="trip" tag="div" class="flex flex-col" appear>
        <div
          v-for="(trip, tripIndex) in sortedTrips"
          :key="trip.id || tripIndex"
          :style="{ '--trip-delay': `${Math.min(tripIndex, 8) * 45}ms` }"
        >
          <TripItem
            :trip="trip"
            :trip-request="trips.request"
            :timeline-start="timelineStart.toDate()"
            :px-per-minute="pxPerMinute"
            :sidebar-width="sidebarWidth"
            @click="navigateToTripDetail"
          />
          <div v-if="tripIndex < sortedTrips.length - 1" class="border-b border-border/50 mx-4" />
        </div>
      </TransitionGroup>

      <div
        v-if="sortedTrips.length === 0"
        class="text-center py-8 text-muted-foreground"
      >
        <p class="text-sm">No trips available</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Staggered entrance: each row fades and lifts in, offset by its index via
   the inline --trip-delay. `appear` replays it whenever a new result set
   mounts (new trip ids). */
.trip-enter-active {
  transition:
    opacity 0.4s ease,
    transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  transition-delay: var(--trip-delay, 0ms);
}

.trip-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

@media (prefers-reduced-motion: reduce) {
  .trip-enter-active {
    transition: opacity 0.2s ease;
    transition-delay: 0ms;
  }
  .trip-enter-from {
    transform: none;
  }
}
</style>
