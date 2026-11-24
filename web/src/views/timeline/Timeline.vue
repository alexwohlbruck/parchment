<script setup lang="ts">
import { computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { HistoryIcon } from 'lucide-vue-next'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionHeader } from '@/components/ui/section-header'
import { Spinner } from '@/components/ui/spinner'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useTimelineStore } from '@/stores/timeline.store'
import { useMapService } from '@/services/map/map.service'
import type { LocationHistoryStop } from '@server/types/location-history.types'
import { IntegrationId } from '@server/types/integration.types'
import TimelineStopRow from '@/components/timeline/TimelineStopRow.vue'
import TimelineSegmentRow from '@/components/timeline/TimelineSegmentRow.vue'
import DailyDistanceChart from '@/components/timeline/DailyDistanceChart.vue'
import TimelineRangeNav from '@/components/timeline/TimelineRangeNav.vue'
import TimelineNoIntegration from '@/components/timeline/TimelineNoIntegration.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import UpgradeBanner from '@/components/subscription/UpgradeBanner.vue'
import { StatTile } from '@/components/ui/stat'
import { formatDurationCompact } from '@/lib/time-format'
import { distancePrecision, groupEntriesByDay, summarizeEntries } from '@/lib/timeline/timeline-days'
import { useUnits } from '@/composables/useUnits'

const authService = useAuthService()
const canAccessTimeline = computed(() => authService.hasPermission(PermissionId.LOCATION_SHARING))

dayjs.extend(localizedFormat)

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const integrationsStore = useIntegrationsStore()
const timelineStore = useTimelineStore()
const mapService = useMapService()
const { formatDistance: formatUnits } = useUnits()
const formatDistance = (meters: number) =>
  formatUnits(meters, { precision: distancePrecision(meters) })

const { range, entries, dailyStats, loading, error } = storeToRefs(timelineStore)

// ── Range helpers ─────────────────────────────────────────────────────────
function applyRange(start: Date, end: Date) {
  timelineStore.setRange({ start, end, mode: 'range' })
}

const presets = [
  { unit: 'day', label: 'timeline.today' },
  { unit: 'week', label: 'timeline.thisWeek' },
  { unit: 'month', label: 'timeline.thisMonth' },
] as const

type PresetUnit = (typeof presets)[number]['unit']

function isPreset(unit: PresetUnit): boolean {
  return (
    dayjs(range.value.start).isSame(dayjs().startOf(unit), 'day') &&
    dayjs(range.value.end).isSame(dayjs().endOf(unit), 'day')
  )
}

function setPreset(unit: PresetUnit) {
  applyRange(dayjs().startOf(unit).toDate(), dayjs().endOf(unit).toDate())
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

function pickDay(day: Date) {
  applyRange(dayjs(day).startOf('day').toDate(), dayjs(day).endOf('day').toDate())
}

// ── Summary ─────────────────────────────────────────────────────────────
const summary = computed(() => summarizeEntries(entries.value))

const isSingleDay = computed(() => dayjs(range.value.start).isSame(range.value.end, 'day'))

const dayGroups = computed(() => groupEntriesByDay(entries.value, range.value.start))

function dayLabel(key: string): string {
  const day = dayjs(key)
  if (day.isSame(dayjs(), 'day')) return t('timeline.today')
  if (day.isSame(dayjs().subtract(1, 'day'), 'day')) return t('timeline.yesterday')
  return day.format('ddd, MMM D')
}

function dayMeta(group: { places: number; distance: number }): string {
  const parts: string[] = []
  if (group.places) parts.push(t('timeline.placeCount', { n: group.places }, group.places))
  if (group.distance) parts.push(formatDistance(group.distance))
  return parts.join(' · ')
}

// ── Map sync ─────────────────────────────────────────────────────────────
function focusStop(stop: LocationHistoryStop) {
  mapService.flyTo({
    center: { lng: stop.coordinate.lng, lat: stop.coordinate.lat },
    zoom: 16,
  })
}

function pickFromChart(date: string) {
  pickDay(dayjs(date).toDate())
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
    <h1 class="text-2xl font-semibold mb-3">{{ t('timeline.title') }}</h1>

    <TimelineRangeNav
      :start="range.start"
      :end="range.end"
      class="-mx-1.5"
      @shift="shiftRange"
      @pick-day="pickDay"
    />

    <div class="flex gap-1.5 mt-2">
      <Chip
        v-for="preset in presets"
        :key="preset.unit"
        variant="toggle"
        size="sm"
        :label="t(preset.label)"
        :model-value="isPreset(preset.unit)"
        @update:model-value="setPreset(preset.unit)"
      />
    </div>

    <DailyDistanceChart
      v-if="dailyStats.length > 0"
      class="-mx-3 mt-3"
      :stats="dailyStats"
      :range-start="dayjs(range.start).format('YYYY-MM-DD')"
      :range-end="dayjs(range.end).format('YYYY-MM-DD')"
      @select="pickFromChart"
    />

    <div v-if="!loading && entries.length > 0" class="grid grid-cols-3 gap-2 mt-3">
      <StatTile :label="t('timeline.stats.places')" :value="summary.places" />
      <StatTile :label="t('timeline.stats.distance')" :value="formatDistance(summary.distance)" />
      <StatTile :label="t('timeline.stats.moving')" :value="formatDurationCompact(summary.moving)" />
    </div>

    <div class="flex-1 mt-4">
      <div v-if="loading" class="flex justify-center py-12">
        <Spinner />
      </div>
      <EmptyState
        v-else-if="error"
        :icon="HistoryIcon"
        variant="inline"
        :title="t('timeline.loadFailed')"
      >
        <Button
          v-if="integrationsStore.isIntegrationDegraded(IntegrationId.DAWARICH)"
          size="sm"
          variant="outline"
          as-child
        >
          <router-link to="/settings/integrations">{{ t('timeline.checkIntegration') }}</router-link>
        </Button>
      </EmptyState>
      <EmptyState
        v-else-if="entries.length === 0"
        :icon="HistoryIcon"
        variant="inline"
        :title="t('timeline.noEvents')"
      />
      <div v-else class="space-y-4">
        <section v-for="group in dayGroups" :key="group.key">
          <SectionHeader
            v-if="!isSingleDay"
            :title="dayLabel(group.key)"
            class="mb-1"
          >
            <template #trailing>
              <span class="text-xs text-muted-foreground tabular-nums shrink-0">{{ dayMeta(group) }}</span>
            </template>
          </SectionHeader>

          <ol class="relative">
            <span class="absolute left-[9.5px] top-4 bottom-4 w-px bg-border" aria-hidden="true" />
            <template v-for="entry in group.entries" :key="entry.id">
              <TimelineStopRow
                v-if="entry.type === 'stop'"
                :stop="entry"
                :day="group.key"
                @select="focusStop"
              />
              <TimelineSegmentRow v-else :segment="entry" :day="group.key" />
            </template>
          </ol>
        </section>
      </div>
    </div>
  </PanelLayout>
</template>
