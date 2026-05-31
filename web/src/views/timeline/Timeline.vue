<script setup lang="ts">
import { computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-vue-next'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useTimelineStore } from '@/stores/timeline.store'
import { useMapService } from '@/services/map.service'
import type { LocationHistoryStop, LocationHistoryEntry } from '@server/types/location-history.types'
import TimelineStopRow from './components/TimelineStopRow.vue'
import TimelineSegmentRow from './components/TimelineSegmentRow.vue'
import DailyDistanceChart from './components/DailyDistanceChart.vue'
import TimelineDatePicker from './components/TimelineDatePicker.vue'
import TimelineNoIntegration from './TimelineNoIntegration.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import UpgradeBanner from '@/components/subscription/UpgradeBanner.vue'

const authService = useAuthService()
const canAccessTimeline = computed(() => authService.hasPermission(PermissionId.LOCATION_SHARING))

dayjs.extend(localizedFormat)

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
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
const rangeStart = computed({
  get: () => range.value.start,
  set: (next: Date) => {
    const newStart = dayjs(next).startOf('day').toDate()
    const delta = newStart.getTime() - range.value.start.getTime()
    const newEnd = new Date(range.value.end.getTime() + delta)
    applyRange(newStart, newEnd)
  },
})

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

// ── Subtitle ────────────────────────────────────────────────────────────
const subtitle = computed(() => {
  return dayjs(range.value.start).format('dddd, MMM D')
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
  return min === 0 ? `${hours}h` : `${hours}h ${min}m`
})

// ── Group entries by day ────────────────────────────────────────────────
interface DayGroup {
  key: string
  label: string
  dateMeta: string
  entries: LocationHistoryEntry[]
  stops: number
  distanceKm: string
}

const dayGroups = computed<DayGroup[]>(() => {
  if (entries.value.length === 0) return []

  const groups = new Map<string, LocationHistoryEntry[]>()
  for (const entry of entries.value) {
    const time = entry.type === 'stop' ? entry.startTime : entry.startTime
    const key = dayjs(time).format('YYYY-MM-DD')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(entry)
  }

  const today = dayjs().format('YYYY-MM-DD')
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')

  return Array.from(groups.entries()).map(([key, dayEntries]) => {
    let label: string
    if (key === today) label = 'Today'
    else if (key === yesterday) label = 'Yesterday'
    else label = dayjs(key).format('ddd, MMM D')

    const stops = dayEntries.filter(e => e.type === 'stop').length
    const distM = dayEntries
      .filter((e): e is Extract<LocationHistoryEntry, { type: 'segment' }> => e.type === 'segment')
      .reduce((sum, s) => sum + s.distance, 0)
    const km = distM / 1000
    const distanceKm = km < 1 ? `${Math.round(distM)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`

    return {
      key,
      label,
      dateMeta: `${dayjs(key).format('MMM D')} · ${stops} ${stops === 1 ? 'place' : 'places'} · ${distanceKm}`,
      entries: dayEntries,
      stops,
      distanceKm,
    }
  })
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
function applyDayFromQuery(raw: unknown) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false
  const parsed = dayjs(raw)
  if (!parsed.isValid()) return false
  timelineStore.setDay(parsed.toDate())
  void router.replace({ query: { ...route.query, day: undefined } })
  return true
}

onMounted(() => {
  if (!integrationsStore.isLocationHistoryActive) return
  if (!applyDayFromQuery(route.query.day)) {
    void timelineStore.load()
  }
})

watch(
  () => route.query.day,
  (day) => {
    if (integrationsStore.isLocationHistoryActive) applyDayFromQuery(day)
  },
)

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
  <PanelLayout v-if="!canAccessTimeline">
    <UpgradeBanner feature="timeline" required-tier="basic" />
  </PanelLayout>

  <TimelineNoIntegration v-else-if="!integrationsStore.isLocationHistoryActive" />

  <PanelLayout v-else>
    <!-- Header -->
    <div class="mb-1">
      <h1 class="text-2xl font-semibold">
        {{ t('timeline.title') }}
      </h1>
      <p class="text-sm text-muted-foreground">{{ subtitle }}</p>
    </div>

    <!-- Stat cards -->
    <div
      v-if="summary.stops > 0 || summary.distanceM > 0"
      class="grid grid-cols-3 gap-2 my-3"
    >
      <div class="border border-border/50 rounded-lg px-3 py-2.5">
        <div class="text-[10px] font-semibold text-muted-foreground">Places</div>
        <div class="text-xl font-semibold tabular-nums mt-1">{{ summary.stops }}</div>
      </div>
      <div class="border border-border/50 rounded-lg px-3 py-2.5">
        <div class="text-[10px] font-semibold text-muted-foreground">Distance</div>
        <div class="text-xl font-semibold tabular-nums mt-1">
          {{ distanceLabel }}
        </div>
      </div>
      <div class="border border-border/50 rounded-lg px-3 py-2.5">
        <div class="text-[10px] font-semibold text-muted-foreground">Active</div>
        <div class="text-xl font-semibold tabular-nums mt-1">
          {{ movingTimeLabel }}
        </div>
      </div>
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

    <!-- Body -->
    <div class="flex-1 overflow-y-auto -mx-4">
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
      <template v-else>
        <template v-for="group in dayGroups" :key="group.key">
          <!-- Day header -->
          <div class="flex items-center justify-between px-4 pt-3.5 pb-1.5">
            <span class="text-lg font-semibold">{{ group.label }}</span>
            <span class="text-[11px] text-muted-foreground tabular-nums">{{ group.dateMeta }}</span>
          </div>

          <!-- Timeline rail -->
          <div class="tl-rail">
            <template v-for="(entry, i) in group.entries" :key="entry.id">
              <TimelineStopRow
                v-if="entry.type === 'stop'"
                :stop="entry"
                :is-last="i === group.entries.length - 1"
                @select="focusStop"
              />
              <TimelineSegmentRow v-else :segment="entry" />
            </template>
          </div>
        </template>
      </template>
    </div>
  </PanelLayout>
</template>

<style scoped>
.tl-rail {
  position: relative;
  margin: 0 16px;
  padding-left: 24px;
}

.tl-rail::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 8px;
  bottom: 8px;
  width: 0.5px;
  background: var(--color-border);
}

:deep(.tl-event) {
  position: relative;
  padding: 8px 0 14px;
  cursor: default;
}

:deep(.tl-event)::before {
  content: "";
  position: absolute;
  left: -21px;
  top: 14px;
  width: 11px;
  height: 11px;
  border-radius: 999px;
  background: var(--color-background);
  border: 1.5px solid var(--color-muted-foreground);
}

:deep(.tl-event[data-kind="place"])::before {
  border-color: var(--color-primary);
  background: var(--color-primary);
}

:deep(.tl-event[data-kind="travel"])::before {
  border-color: var(--color-border);
  background: var(--color-background);
}

:deep(.tl-event .time) {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--color-muted-foreground);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

:deep(.tl-event .title) {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-foreground);
  margin-top: 1px;
  letter-spacing: -0.005em;
}

:deep(.tl-event[data-kind="travel"] .title) {
  color: var(--color-muted-foreground);
  font-weight: 500;
}

:deep(.tl-event .meta) {
  font-size: 11px;
  color: var(--color-muted-foreground);
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

:deep(.tl-event .meta > *) {
  white-space: nowrap;
}

:deep(.tl-event .meta .dot) {
  width: 2px;
  height: 2px;
  background: var(--color-muted-foreground);
  opacity: 0.4;
  border-radius: 999px;
}

:deep(.tl-event .meta .meta-mode) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
}

:deep(.tl-event[data-kind="place"]) {
  cursor: pointer;
}

:deep(.tl-event[data-kind="place"]:hover .title) {
  color: var(--color-primary);
}
</style>
