<script setup lang="ts">
import { computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-vue-next'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useTimelineStore } from '@/stores/timeline.store'
import { useMapService } from '@/services/map.service'
import type { LocationHistoryStop } from '@server/types/location-history.types'
import TimelineStopRow from './components/TimelineStopRow.vue'
import TimelineSegmentRow from './components/TimelineSegmentRow.vue'
import DailyDistanceChart from './components/DailyDistanceChart.vue'
import TimelineDatePicker from './components/TimelineDatePicker.vue'
import TimelineNoIntegration from './TimelineNoIntegration.vue'

dayjs.extend(localizedFormat)

const { t } = useI18n()
const integrationsStore = useIntegrationsStore()
const timelineStore = useTimelineStore()
const mapService = useMapService()

const { range, entries, dailyStats, loading, error } = storeToRefs(timelineStore)

// ── Range helpers ─────────────────────────────────────────────────────────
function applyRange(start: Date, end: Date) {
  timelineStore.setRange({ start, end, mode: 'range' })
}

const isToday = computed(() => {
  const d = dayjs(range.value.start)
  return (
    d.isSame(dayjs(), 'day') &&
    dayjs(range.value.end).isSame(dayjs(), 'day') &&
    range.value.end.getTime() - range.value.start.getTime() < 36 * 3600 * 1000
  )
})

const isThisWeek = computed(() => {
  const a = dayjs().startOf('week')
  const b = dayjs().endOf('week')
  return (
    dayjs(range.value.start).isSame(a, 'day') &&
    dayjs(range.value.end).isSame(b, 'day')
  )
})

const isThisMonth = computed(() => {
  const a = dayjs().startOf('month')
  const b = dayjs().endOf('month')
  return (
    dayjs(range.value.start).isSame(a, 'day') &&
    dayjs(range.value.end).isSame(b, 'day')
  )
})

function setToday() {
  const start = dayjs().startOf('day').toDate()
  const end = dayjs().endOf('day').toDate()
  applyRange(start, end)
}

function setThisWeek() {
  const start = dayjs().startOf('week').toDate()
  const end = dayjs().endOf('week').toDate()
  applyRange(start, end)
}

function setThisMonth() {
  const start = dayjs().startOf('month').toDate()
  const end = dayjs().endOf('month').toDate()
  applyRange(start, end)
}

/**
 * Shift the entire range by its own length in days, in either direction.
 *
 * Day-based (not ms-based) so we don't bleed across date boundaries when
 * the range is `[00:00:00, 23:59:59.999]` — a literal ms shift would land
 * the new range at `00:00:00.001` of the prior day through `00:00:00` of
 * the original day, which the chart bucketed as two highlighted days.
 */
function shiftRange(direction: 1 | -1) {
  const days = Math.max(
    1,
    Math.round(
      (range.value.end.getTime() - range.value.start.getTime()) /
        (24 * 3600 * 1000),
    ),
  )
  const delta = direction * days
  applyRange(
    dayjs(range.value.start).add(delta, 'day').toDate(),
    dayjs(range.value.end).add(delta, 'day').toDate(),
  )
}

// ── Pickers ───────────────────────────────────────────────────────────────
// Start change preserves duration by shifting end the same delta.
const rangeStart = computed({
  get: () => range.value.start,
  set: (next: Date) => {
    const newStart = dayjs(next).startOf('day').toDate()
    const delta = newStart.getTime() - range.value.start.getTime()
    const newEnd = new Date(range.value.end.getTime() + delta)
    applyRange(newStart, newEnd)
  },
})

// End change keeps start fixed; if end < start, snap end to start's day-end.
const rangeEnd = computed({
  get: () => range.value.end,
  set: (next: Date) => {
    let newEnd = dayjs(next).endOf('day').toDate()
    if (newEnd.getTime() < range.value.start.getTime()) {
      newEnd = dayjs(range.value.start).endOf('day').toDate()
    }
    applyRange(range.value.start, newEnd)
  },
})

// ── Day summary ──────────────────────────────────────────────────────────
const summary = computed(() => {
  let stops = 0
  let distanceM = 0
  let movingS = 0
  for (const e of entries.value) {
    if (e.type === 'stop') stops++
    else {
      distanceM += e.distance
      movingS += e.duration
    }
  }
  return { stops, distanceM, movingS }
})

const distanceLabel = computed(() => {
  const km = summary.value.distanceM / 1000
  if (km < 1) return `${Math.round(summary.value.distanceM)} m`
  return `${km.toFixed(km < 10 ? 1 : 0)} km`
})

const movingTimeLabel = computed(() => {
  const totalMin = Math.round(summary.value.movingS / 60)
  if (totalMin < 60) return `${totalMin} min`
  const hours = Math.floor(totalMin / 60)
  const min = totalMin % 60
  return min === 0 ? `${hours} h` : `${hours} h ${min} min`
})

// ── Map sync ─────────────────────────────────────────────────────────────
function focusStop(stop: LocationHistoryStop) {
  mapService.flyTo({
    center: { lng: stop.coordinate.lng, lat: stop.coordinate.lat },
    zoom: 16,
  })
}

function pickFromChart(date: string) {
  const start = dayjs(date).startOf('day').toDate()
  const end = dayjs(date).endOf('day').toDate()
  applyRange(start, end)
}

// ── Lifecycle ────────────────────────────────────────────────────────────
onMounted(() => {
  if (integrationsStore.isLocationHistoryActive) {
    void timelineStore.load()
  }
})

watch(
  () => integrationsStore.isLocationHistoryActive,
  (active) => {
    if (active) void timelineStore.load()
    else timelineStore.clear()
  },
)

onBeforeUnmount(() => {
  timelineStore.clear()
})
</script>

<template>
  <TimelineNoIntegration v-if="!integrationsStore.isLocationHistoryActive" />

  <PanelLayout v-else>
    <!-- Header -->
    <div class="flex items-baseline justify-between mb-4">
      <h1 class="text-2xl font-semibold tracking-tight">
        {{ t('timeline.title') }}
      </h1>
    </div>

    <!-- Shortcut chips -->
    <div class="flex gap-1.5 mb-3">
      <Button
        :variant="isToday ? 'default' : 'outline'"
        size="sm"
        class="h-7 text-xs flex-1"
        @click="setToday"
      >
        {{ t('timeline.today') }}
      </Button>
      <Button
        :variant="isThisWeek ? 'default' : 'outline'"
        size="sm"
        class="h-7 text-xs flex-1"
        @click="setThisWeek"
      >
        {{ t('timeline.thisWeek') }}
      </Button>
      <Button
        :variant="isThisMonth ? 'default' : 'outline'"
        size="sm"
        class="h-7 text-xs flex-1"
        @click="setThisMonth"
      >
        {{ t('timeline.thisMonth') }}
      </Button>
    </div>

    <!-- Range pickers + prev/next -->
    <div class="flex items-center gap-1 mb-4">
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0"
        @click="shiftRange(-1)"
      >
        <ChevronLeftIcon class="w-4 h-4" />
      </Button>
      <div class="grid grid-cols-2 gap-2 flex-1 min-w-0">
        <TimelineDatePicker v-model="rangeStart" class="h-8 text-sm" />
        <TimelineDatePicker v-model="rangeEnd" class="h-8 text-sm" />
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0"
        @click="shiftRange(1)"
      >
        <ChevronRightIcon class="w-4 h-4" />
      </Button>
    </div>

    <!-- Day summary — places · distance · moving time. Hidden when there's
         nothing to show; otherwise gives an at-a-glance read of the range
         without making the user scroll the entries. -->
    <div
      v-if="summary.stops > 0 || summary.distanceM > 0"
      class="text-xs text-muted-foreground tabular-nums mb-3 flex items-center gap-1.5"
    >
      <span>
        {{ summary.stops }}
        {{ summary.stops === 1 ? 'place' : 'places' }}
      </span>
      <span class="text-muted-foreground/40">·</span>
      <span>{{ distanceLabel }}</span>
      <span class="text-muted-foreground/40">·</span>
      <span>{{ movingTimeLabel }}</span>
    </div>

    <!-- Daily distance chart -->
    <div v-if="dailyStats.length > 0" class="-mx-3 mb-3">
      <DailyDistanceChart
        :stats="dailyStats"
        :range-start="dayjs(range.start).format('YYYY-MM-DD')"
        :range-end="dayjs(range.end).format('YYYY-MM-DD')"
        @select="pickFromChart"
      />
    </div>

    <!-- Body -->
    <div class="flex-1 overflow-y-auto -mx-3">
      <div v-if="loading" class="flex justify-center py-12">
        <Spinner />
      </div>
      <div
        v-else-if="error"
        class="text-center py-12 text-sm text-destructive"
      >
        {{ t('timeline.loadFailed') }}
      </div>
      <div
        v-else-if="entries.length === 0"
        class="text-center py-12 text-sm text-muted-foreground"
      >
        {{ t('timeline.noEvents') }}
      </div>
      <div v-else class="px-3">
        <div class="flex flex-col">
          <template v-for="(entry, i) in entries" :key="entry.id">
            <TimelineStopRow
              v-if="entry.type === 'stop'"
              :stop="entry"
              @select="focusStop"
            />
            <TimelineSegmentRow v-else :segment="entry" />
            <div v-if="i < entries.length - 1" class="h-px" />
          </template>
        </div>
      </div>
    </div>
  </PanelLayout>
</template>
