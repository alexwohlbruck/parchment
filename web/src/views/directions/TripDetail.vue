<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useDirectionsStore } from '@/stores/directions.store'
import { useDirectionsService } from '@/services/directions.service'
import { useMapService } from '@/services/map.service'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Caption } from '@/components/ui/typography'
import {
  AccessibilityIcon,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  BikeIcon,
  BookmarkIcon,
  CarFrontIcon,
  ChevronDownIcon,
  ClockIcon,
  FlagIcon,
  FootprintsIcon,
  ShareIcon,
  TrainIcon,
  TruckIcon,
  Undo2Icon,
} from 'lucide-vue-next'
import { AppRoute } from '@/router'
import type { RouteInstruction } from '@/types/directions.types'
import type { RouteProfileType } from '@/lib/route-profile-colors'
import ElevationChart from '@/components/directions/ElevationChart.vue'
import { useUnits } from '@/composables/useUnits'

const route = useRoute()
const router = useRouter()
const directionsStore = useDirectionsStore()
const directionsService = useDirectionsService()
const mapService = useMapService()
const { formatDistance, formatElevation } = useUnits()

const hoveredInstructionKey = ref<string | null>(null)

const tripId = computed(() => route.params.id as string)
const isLoading = ref(false)
const error = ref<string | null>(null)

const trip = computed(() => {
  if (!directionsStore.trips?.trips) return null
  return directionsStore.trips.trips.find(t => t.id === tripId.value) || null
})

watch(
  trip,
  newTrip => {
    if (newTrip === null && !isLoading.value && directionsStore.trips) {
      router.push({ name: AppRoute.DIRECTIONS })
    }
  },
  { immediate: true },
)

const modeIcons = {
  walking: FootprintsIcon,
  driving: CarFrontIcon,
  cycling: BikeIcon,
  biking: BikeIcon,
  transit: TrainIcon,
  truck: TruckIcon,
  wheelchair: AccessibilityIcon,
} as const

const modeColors = {
  walking: 'bg-cobalt-500',
  driving: 'bg-violet-500',
  cycling: 'bg-forest-500',
  biking: 'bg-forest-500',
  transit: 'bg-parchment-500',
  truck: 'bg-compass-500',
  wheelchair: 'bg-teal-500',
} as const

const modeTextColors: Record<string, string> = {
  walking: 'text-cobalt-500',
  driving: 'text-violet-500',
  cycling: 'text-forest-500',
  biking: 'text-forest-500',
  transit: 'text-parchment-600',
  truck: 'text-compass-500',
  wheelchair: 'text-teal-500',
}

watch(
  trip,
  newTrip => {
    if (newTrip) {
      mapService.setVisibleTrips([newTrip.id])
    }
  },
  { immediate: true },
)

onBeforeRouteLeave(to => {
  mapService.setRouteProfile(null)
  if (to.name === AppRoute.DIRECTIONS) {
    if (tripId.value) {
      mapService.setVisibleTrips([tripId.value])
    }
  } else {
    directionsService.clearWaypoints()
    directionsStore.unsetTrips()
  }
})

function onInstructionHover(
  segmentIndex: number,
  instrIndex: number,
  instruction: string | RouteInstruction,
) {
  hoveredInstructionKey.value = `${segmentIndex}-${instrIndex}`
  if (typeof instruction === 'object' && instruction.coordinate) {
    mapService.highlightInstructionPoint(segmentIndex, instrIndex)
  }
}

function onInstructionLeave() {
  hoveredInstructionKey.value = null
  mapService.clearHighlightedInstructionPoint()
}

function getInstructionKey(segmentIndex: number, instrIndex: number): string {
  return `${segmentIndex}-${instrIndex}`
}

function getInstructionIcon(instruction: string | RouteInstruction) {
  if (typeof instruction === 'string') return ArrowUp
  if (instruction.type === 'arrive' || instruction.type === 'destination') return FlagIcon
  switch (instruction.modifier) {
    case 'left': return ArrowLeft
    case 'right': return ArrowRight
    case 'straight': return ArrowUp
    case 'slight-left': return ArrowUpLeft
    case 'slight-right': return ArrowUpRight
    case 'u-turn': return Undo2Icon
    default: return ArrowUp
  }
}

const heroDuration = computed(() => {
  if (!trip.value) return { main: '', suffix: '' }
  const s = trip.value.summary.totalDuration
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  if (hours > 0) return { main: `${hours}h ${minutes}m`, suffix: '' }
  return { main: String(minutes), suffix: 'min' }
})

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const formatDistanceDisplay = (meters: number | undefined): string => {
  if (!meters) return formatDistance(0)
  return formatDistance(meters)
}

const formatTime = (date: Date): string => {
  return new Date(date).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function onRouteProfileChange(
  segmentIndex: number,
  profile: RouteProfileType | null,
) {
  if (!trip.value) return
  mapService.setSegmentRouteProfile(trip.value.id, segmentIndex, profile)
}

const formatCurrency = (cost: { currency: string; amount: number }): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cost.currency,
  }).format(cost.amount)
}

const PREVIEW_COUNT = 3

// ── Route waypoints ────────────────────────────────────────────────

interface RouteWaypointDisplay {
  id: string
  role: 'origin' | 'via' | 'destination'
  displayName: string
  time: Date | null
}

const routeWaypoints = computed<RouteWaypointDisplay[]>(() => {
  const waypoints = directionsStore.trips?.request?.waypoints
  const t = trip.value
  if (!waypoints || waypoints.length === 0 || !t) return []

  let viaCounter = 0
  return waypoints.map((wp, i) => {
    const isOrigin = i === 0
    const isDestination = i === waypoints.length - 1
    const role: 'origin' | 'via' | 'destination' = isOrigin
      ? 'origin'
      : isDestination
        ? 'destination'
        : 'via'
    const fallbackName = isOrigin
      ? 'Origin'
      : isDestination
        ? 'Destination'
        : `Stop ${++viaCounter}`
    return {
      id: wp.id || `wp-${i}`,
      role,
      displayName: wp.name?.trim() || fallbackName,
      time: isOrigin ? t.startTime : isDestination ? t.endTime : null,
    }
  })
})

// ── Unified timeline ───────────────────────────────────────────────

interface TimelineWaypointEntry {
  kind: 'waypoint'
  wp: RouteWaypointDisplay
  waypointIndex: number
}

interface TimelineSegmentEntry {
  kind: 'segment'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segment: any
  segmentIndex: number
}

type TimelineEntry = TimelineWaypointEntry | TimelineSegmentEntry

const timelineEntries = computed<TimelineEntry[]>(() => {
  const t = trip.value
  if (!t) return []
  const entries: TimelineEntry[] = []
  const wps = routeWaypoints.value
  const segs = t.segments

  const origin = wps.find(w => w.role === 'origin')
  entries.push({
    kind: 'waypoint',
    waypointIndex: 0,
    wp: origin ?? {
      id: 'origin',
      role: 'origin',
      displayName: '',
      time: segs[0]?.startTime ?? t.startTime,
    },
  })

  for (let i = 0; i < segs.length; i++) {
    entries.push({ kind: 'segment', segment: segs[i], segmentIndex: i })

    const viaIndex = i + 1
    if (viaIndex < wps.length - 1) {
      const via = wps[viaIndex]
      if (via?.role === 'via') {
        entries.push({ kind: 'waypoint', wp: via, waypointIndex: viaIndex })
      }
    }
  }

  const dest = wps.find(w => w.role === 'destination')
  entries.push({
    kind: 'waypoint',
    waypointIndex: Math.max(wps.length - 1, 1),
    wp: dest ?? {
      id: 'destination',
      role: 'destination',
      displayName: '',
      time: segs[segs.length - 1]?.endTime ?? t.endTime,
    },
  })

  return entries
})

// ── Rail color helper ──────────────────────────────────────────────

function getRailColor(entryIndex: number, position: 'above' | 'below'): string {
  const entries = timelineEntries.value
  const search = position === 'above' ? -1 : 1
  for (let j = entryIndex + search; j >= 0 && j < entries.length; j += search) {
    const e = entries[j]
    if (e.kind === 'segment') {
      return modeColors[e.segment.mode as keyof typeof modeColors] || 'bg-parchment-500'
    }
  }
  return 'bg-border'
}

// ── Segment helpers ────────────────────────────────────────────────

function showSegmentChart(segment: any): boolean {
  return !!(
    segment.geometry &&
    (segment.totalElevationGain ||
      segment.totalElevationLoss ||
      segment.edgeSegments?.length) &&
    (segment.mode === 'walking' ||
      segment.mode === 'cycling' ||
      segment.mode === 'wheelchair')
  )
}

function hasSegmentRouteInfo(segment: any): boolean {
  return !!(
    segment.totalElevationGain ||
    segment.totalElevationLoss ||
    showSegmentChart(segment)
  )
}
</script>

<template>
  <div class="h-full w-full overflow-y-auto">
    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <Caption>Loading trip details...</Caption>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="p-4">
      <Caption class="text-destructive">{{ error }}</Caption>
    </div>

    <!-- Trip content -->
    <div v-else-if="trip" class="pb-6">
      <!-- Hero -->
      <div class="px-4 pt-3 flex items-start justify-between gap-4">
        <div>
          <div class="flex items-baseline gap-2">
            <span class="font-display text-[36px] leading-none tracking-tight">
              {{ heroDuration.main }}
            </span>
            <span
              v-if="heroDuration.suffix"
              class="font-display text-[22px] leading-none text-muted-foreground"
            >
              {{ heroDuration.suffix }}
            </span>
            <span class="text-sm text-muted-foreground">
              {{ formatDistanceDisplay(trip.summary.totalDistance) }}
            </span>
          </div>

          <!-- Cost / CO2 -->
          <div
            v-if="trip.cost?.total || trip.co2Emissions"
            class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
          >
            <span v-if="trip.cost?.total">
              {{ formatCurrency(trip.cost.total) }}
            </span>
            <span v-if="trip.co2Emissions">
              {{ trip.co2Emissions.toFixed(1) }}kg CO₂
            </span>
          </div>
        </div>

        <!-- Share + Save -->
        <div class="flex gap-0.5 shrink-0 -mr-2 -mt-1">
          <Button variant="ghost" size="icon-sm">
            <ShareIcon class="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm">
            <BookmarkIcon class="size-4" />
          </Button>
        </div>
      </div>

      <!-- Timezone warning -->
      <div
        v-if="directionsStore.timezoneWarning"
        class="mx-4 mt-3 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-sm"
      >
        <ClockIcon class="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span class="text-amber-800 dark:text-amber-200">
          Your destination is in a different time zone ({{ directionsStore.timezoneWarning.offsetDifferenceText }})
        </span>
      </div>

      <!-- ── Unified timeline ─────────────────────────────────── -->
      <!--
        Layout: each entry is a flex row [rail | content].
        Rail is 28px wide, icons are top-aligned with text via shared pt.
        Lines are absolute-positioned behind icons (z-10) with overlap
        to eliminate sub-pixel gaps between entries.

        Waypoint dot: 16px (size-4), center at 10px from entry top (2px mt + 8px half).
        Segment icon: 28px (size-7), center at 19px from entry top (5px mt + 14px half).
          The 5px mt centers the icon against the full header (~38px: title + subtitle).
        Line overlap: 2px past entry edges to guarantee seamless joins.
      -->
      <div class="mt-4 pl-4">
        <div
          v-for="(entry, i) in timelineEntries"
          :key="entry.kind === 'waypoint' ? entry.wp.id : `seg-${entry.segmentIndex}`"
          class="flex"
        >
          <!-- Rail column — fixed width, relative for absolute lines -->
          <div class="relative flex flex-col items-center w-7 shrink-0">

            <!-- ── Waypoint rail ── -->
            <template v-if="entry.kind === 'waypoint'">
              <!-- Line above dot: from top of entry (with 2px overlap) to dot center -->
              <div
                v-if="i > 0"
                class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[-2px] h-[12px]"
                :class="getRailColor(i, 'above')"
              />
              <!-- Line below dot: from dot center to bottom of entry (with 2px overlap) -->
              <div
                v-if="i < timelineEntries.length - 1"
                class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[10px] bottom-[-2px]"
                :class="getRailColor(i, 'above')"
              />
              <!-- Dot — top-aligned with text via pt-0.5 -->
              <div
                class="relative z-10 mt-0.5 size-4 rounded-full flex items-center justify-center shrink-0"
                :class="entry.waypointIndex === 0
                  ? 'bg-background border-[1.5px] border-foreground/60'
                  : 'bg-primary'"
              >
                <span
                  v-if="entry.waypointIndex > 0"
                  class="text-[9px] font-bold text-primary-foreground"
                >
                  {{ entry.waypointIndex }}
                </span>
              </div>
            </template>

            <!-- ── Segment rail ── -->
            <template v-else>
              <!-- Line above icon: previous segment's color, from top (with overlap) to icon center -->
              <div
                class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[-2px] h-[21px]"
                :class="getRailColor(i, 'above')"
              />
              <!-- Line below icon: this segment's color, from icon center to bottom (with overlap) -->
              <div
                v-if="i < timelineEntries.length - 1"
                class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[19px] bottom-[-2px]"
                :class="modeColors[entry.segment.mode as keyof typeof modeColors] || 'bg-parchment-500'"
              />
              <!-- Mode icon — mt-[5px] centers 28px icon against ~38px header (title + subtitle) -->
              <div
                :class="[
                  'relative z-10 mt-[5px] shrink-0 size-7 rounded-full flex items-center justify-center text-white',
                  modeColors[entry.segment.mode as keyof typeof modeColors] || 'bg-parchment-500',
                ]"
              >
                <component
                  :is="modeIcons[entry.segment.mode as keyof typeof modeIcons] || FootprintsIcon"
                  class="size-3.5"
                />
              </div>
            </template>
          </div>

          <!-- Content column -->
          <div
            class="flex-1 min-w-0 pr-4"
            :class="entry.kind === 'waypoint' ? 'pl-3 pb-4' : 'pl-2.5 pb-5'"
          >
            <!-- ═══ Waypoint content ═══ -->
            <template v-if="entry.kind === 'waypoint'">
              <div class="flex items-baseline gap-2 min-h-5 mt-px">
                <span
                  v-if="entry.wp.time"
                  class="text-sm font-medium tabular-nums shrink-0"
                >
                  {{ formatTime(entry.wp.time) }}
                </span>
                <span
                  v-if="entry.wp.displayName && entry.wp.displayName !== 'Origin' && entry.wp.displayName !== 'Destination'"
                  class="text-sm text-foreground truncate"
                >
                  {{ entry.wp.displayName }}
                </span>
                <span
                  v-else-if="entry.wp.role === 'destination' && entry.wp.displayName === 'Destination'"
                  class="text-sm text-muted-foreground"
                >
                  Destination
                </span>
                <span
                  v-else-if="entry.wp.role === 'via'"
                  class="text-sm text-muted-foreground"
                >
                  {{ entry.wp.displayName }}
                </span>
              </div>
            </template>

            <!-- ═══ Segment content ═══ -->
            <template v-else>
              <div>
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span
                    :class="[
                      'text-sm font-semibold capitalize',
                      modeTextColors[entry.segment.mode] || 'text-foreground',
                    ]"
                  >
                    {{ entry.segment.mode }}
                  </span>
                  <span class="text-sm text-muted-foreground">
                    {{ formatDuration(entry.segment.duration) }} · {{ formatDistanceDisplay(entry.segment.distance) }}
                  </span>
                </div>
                <div
                  v-if="entry.segment.startTime && entry.segment.endTime"
                  class="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums"
                >
                  <ClockIcon class="size-3" />
                  {{ formatTime(entry.segment.startTime) }} – {{ formatTime(entry.segment.endTime) }}
                </div>
              </div>

              <!-- Route info card -->
              <div
                v-if="hasSegmentRouteInfo(entry.segment)"
                class="mt-3 rounded-lg border bg-card p-3.5 space-y-3"
              >
                <!-- Stats grid -->
                <div
                  v-if="entry.segment.totalElevationGain || entry.segment.totalElevationLoss"
                  class="grid grid-cols-3 gap-2 pb-3 border-b"
                >
                  <div>
                    <div class="text-[11px] text-muted-foreground font-medium">Distance</div>
                    <div class="text-base font-medium tabular-nums mt-0.5 tracking-tight">
                      {{ formatDistanceDisplay(entry.segment.distance) }}
                    </div>
                  </div>
                  <div v-if="entry.segment.totalElevationGain">
                    <div class="text-[11px] text-muted-foreground font-medium">Ascent</div>
                    <div class="text-base font-medium tabular-nums mt-0.5 tracking-tight">
                      {{ formatElevation(entry.segment.totalElevationGain) }}
                    </div>
                  </div>
                  <div v-if="entry.segment.totalElevationLoss">
                    <div class="text-[11px] text-muted-foreground font-medium">Descent</div>
                    <div class="text-base font-medium tabular-nums mt-0.5 tracking-tight">
                      {{ formatElevation(entry.segment.totalElevationLoss) }}
                    </div>
                  </div>
                </div>

                <!-- Elevation chart + profile -->
                <ElevationChart
                  v-if="showSegmentChart(entry.segment)"
                  :segment-index="entry.segmentIndex"
                  :geometry="entry.segment.geometry!"
                  :max-elevation="entry.segment.maxElevation"
                  :min-elevation="entry.segment.minElevation"
                  :edge-segments="entry.segment.edgeSegments"
                  :mode="entry.segment.mode"
                  :total-elevation-gain="entry.segment.totalElevationGain"
                  :total-elevation-loss="entry.segment.totalElevationLoss"
                  @update:route-profile="onRouteProfileChange"
                />
              </div>

              <!-- Turn-by-turn -->
              <Collapsible
                v-if="entry.segment.instructions?.length"
                v-slot="{ open }"
                class="mt-3"
              >
                <!-- Section header -->
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs font-medium text-muted-foreground">
                    Turn-by-turn
                  </span>
                  <CollapsibleTrigger
                    v-if="entry.segment.instructions.length > PREVIEW_COUNT"
                    as-child
                  >
                    <Button variant="ghost" size="sm" class="h-7 text-xs text-muted-foreground -mr-2">
                      {{ open ? 'Show less' : `Show all ${entry.segment.instructions.length}` }}
                      <ChevronDownIcon
                        class="size-3 ml-0.5 transition-transform"
                        :class="{ 'rotate-180': open }"
                      />
                    </Button>
                  </CollapsibleTrigger>
                </div>

                <!-- Preview steps -->
                <div class="relative">
                  <div>
                    <div
                      v-for="(instruction, instrIndex) in entry.segment.instructions.slice(0, PREVIEW_COUNT)"
                      :key="instrIndex"
                      class="step-row"
                      :class="{
                        'step-row-active': hoveredInstructionKey === getInstructionKey(entry.segmentIndex, Number(instrIndex)),
                      }"
                      @mouseenter="onInstructionHover(entry.segmentIndex, Number(instrIndex), instruction)"
                      @mouseleave="onInstructionLeave"
                    >
                      <span class="step-num">{{ Number(instrIndex) + 1 }}</span>
                      <span class="step-icon">
                        <component :is="getInstructionIcon(instruction)" class="size-3.5" />
                      </span>
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-foreground leading-snug">
                          {{ typeof instruction === 'string' ? instruction : instruction.text }}
                        </div>
                        <div
                          v-if="typeof instruction === 'object' && instruction.streetName"
                          class="text-[11px] text-muted-foreground mt-0.5"
                        >
                          {{ instruction.streetName }}
                        </div>
                      </div>
                      <span
                        v-if="typeof instruction === 'object'"
                        class="step-dist"
                      >
                        {{ formatDistanceDisplay(instruction.distance) }}
                        <template v-if="instruction.duration">
                          · {{ formatDuration(instruction.duration) }}
                        </template>
                      </span>
                    </div>
                  </div>
                  <div
                    v-if="!open && entry.segment.instructions.length > PREVIEW_COUNT"
                    class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent"
                  />
                </div>

                <!-- Remaining steps -->
                <CollapsibleContent v-if="entry.segment.instructions.length > PREVIEW_COUNT">
                  <div>
                    <div
                      v-for="(instruction, j) in entry.segment.instructions.slice(PREVIEW_COUNT)"
                      :key="Number(j) + PREVIEW_COUNT"
                      class="step-row"
                      :class="{
                        'step-row-active': hoveredInstructionKey === getInstructionKey(entry.segmentIndex, Number(j) + PREVIEW_COUNT),
                      }"
                      @mouseenter="onInstructionHover(entry.segmentIndex, Number(j) + PREVIEW_COUNT, instruction)"
                      @mouseleave="onInstructionLeave"
                    >
                      <span class="step-num">{{ Number(j) + PREVIEW_COUNT + 1 }}</span>
                      <span class="step-icon">
                        <component :is="getInstructionIcon(instruction)" class="size-3.5" />
                      </span>
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-foreground leading-snug">
                          {{ typeof instruction === 'string' ? instruction : instruction.text }}
                        </div>
                        <div
                          v-if="typeof instruction === 'object' && instruction.streetName"
                          class="text-[11px] text-muted-foreground mt-0.5"
                        >
                          {{ instruction.streetName }}
                        </div>
                      </div>
                      <span
                        v-if="typeof instruction === 'object'"
                        class="step-dist"
                      >
                        {{ formatDistanceDisplay(instruction.distance) }}
                        <template v-if="instruction.duration">
                          · {{ formatDuration(instruction.duration) }}
                        </template>
                      </span>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div
                v-else-if="!entry.segment.instructions?.length"
                class="mt-3 text-sm text-muted-foreground italic"
              >
                No detailed instructions available for this segment.
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- No trip found -->
    <div v-else class="p-4">
      <Caption>Trip not found</Caption>
    </div>
  </div>
</template>

<style scoped>
.step-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 4px;
  margin: 0 -4px;
  cursor: default;
  border-radius: 6px;
  transition: background 0.1s;
}
.step-row:hover,
.step-row-active {
  background: hsl(var(--muted) / 0.5);
}
.step-num {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  width: 16px;
  flex: none;
  text-align: right;
  color: hsl(var(--muted-foreground));
  font-weight: 500;
  line-height: 1.5;
  padding-top: 3px;
  font-variant-numeric: tabular-nums;
}
.step-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  flex: none;
  background: hsl(var(--muted));
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground));
}
.step-dist {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  font-variant-numeric: tabular-nums;
  text-align: right;
  flex: none;
  padding-top: 3px;
  white-space: nowrap;
}
</style>
