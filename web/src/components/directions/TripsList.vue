<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import dayjs from 'dayjs'
import type { TripsResponse } from '@/types/directions.types'
import TripItem from './TripItem.vue'
import TripRows from './TripRows.vue'
import { useTripNavigation } from '@/composables/directions/useTripNavigation'
import { byRank } from '@/lib/directions/trip-display'

interface Props {
  trips: TripsResponse
  /** Height (px) of the pinned controls above; the time axis docks below it. */
  stickyTop?: number
}

const props = withDefaults(defineProps<Props>(), {
  stickyTop: 0,
})

const MIN_PX_PER_MIN = 1.5
const MAX_PX_PER_MIN = 50

const containerRef = ref<HTMLElement | null>(null)
const containerWidth = ref(360)
const sidebarWidth = ref(0)

let observer: ResizeObserver | null = null

const scrollRef = ref<HTMLElement | null>(null)
const scrollLeft = ref(0)

function onScroll() {
  scrollLeft.value = scrollRef.value?.scrollLeft ?? 0
}

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
  if (scrollRef.value) scrollRef.value.scrollLeft = 0
  scrollLeft.value = 0
  nextTick(() => updateWidth())
})

onUnmounted(() => {
  observer?.disconnect()
})

const sortedTrips = computed(() => byRank(props.trips.trips))

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

const tickIntervals = computed((): { tickSec: number; labelSec: number } | { tick: number; label: number } => {
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

const { openTrip } = useTripNavigation(() => props.trips.request)
</script>

<template>
  <div ref="containerRef" class="min-w-0">
    <!-- Time axis — opaque so suggestions are fully hidden as they scroll
         under it, docked just below the pinned controls. It sits outside the
         horizontal scroller (which would capture its vertical stickiness) and
         mirrors that scroller's offset instead.

         z above the trip caps (z-20) so rows are fully hidden under it, but
         below the pinned controls (z-30). -->
    <div
      class="sticky z-[25] pt-2 pb-1 border-b border-border/40 bg-background"
      :style="{ top: `calc(var(--sheet-sticky-top, 0px) + ${stickyTop}px)` }"
    >
      <!-- Ticks are positioned from the bar column's origin, so the track is
           offset by the sidebar and then panned with the rows. It spans the
           full width: once scrolled, bars reach the panel's left edge too. -->
      <div class="relative h-7 overflow-hidden">
        <div
          class="absolute inset-0"
          :style="{ transform: `translateX(${sidebarWidth - scrollLeft}px)` }"
        >
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
    </div>

    <!-- The timeline outruns the panel whenever a trip is longer than the
         fitted range, so the rows pan horizontally. Bottom padding gives the
         entrance transform room before overflow clips it. -->
    <div
      ref="scrollRef"
      class="trip-scroll overflow-x-auto overflow-y-hidden overscroll-x-contain pb-3 -mb-3"
      @scroll.passive="onScroll"
    >
      <div
        :style="{
          minWidth: sortedTrips.length
            ? `${timelineWidth + sidebarWidth}px`
            : undefined,
        }"
      >
        <TripRows :trips="trips.trips" v-slot="{ trip }">
          <TripItem
            :trip="trip"
            :trip-request="trips.request"
            :timeline-start="timelineStart.toDate()"
            :px-per-minute="pxPerMinute"
            :sidebar-width="sidebarWidth"
            :bar-area-width="barAreaWidth"
            @click="openTrip"
          />
        </TripRows>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trip-scroll {
  scrollbar-width: none;
}
.trip-scroll::-webkit-scrollbar {
  display: none;
}
</style>
