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
  AlertTriangleIcon,
  ArrowLeft,
  BikeIcon,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  BookmarkIcon,
  ChevronDownIcon,
  ClockIcon,
  FlagIcon,
  FootprintsIcon,
  ShareIcon,
  Undo2Icon,
} from 'lucide-vue-next'
import { AppRoute } from '@/router'
import type { RouteInstruction } from '@/types/directions.types'
import type { Place } from '@/types/place.types'
import type { RouteProfileType } from '@/lib/route-profile-colors'
import { getSegmentIcon } from '@/lib/travel-mode-icons'
import { getPlaceRoute } from '@/lib/place.utils'
import {
  getSearchResultIconName,
  getSearchResultIconPack,
  getSearchResultCategory,
} from '@/lib/search.utils'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import { ItemIcon } from '@/components/ui/item-icon'
import ElevationChart from '@/components/directions/ElevationChart.vue'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'
import { useUnits } from '@/composables/useUnits'

const route = useRoute()
const router = useRouter()
const directionsStore = useDirectionsStore()
const directionsService = useDirectionsService()
const mapService = useMapService()
const themeStore = useThemeStore()
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

function formatCo2(kg: number): string {
  if (kg >= 1) return `${kg.toFixed(1)} kg`
  return `${Math.round(kg * 1000)} g`
}

const PREVIEW_COUNT = 3

// ── Route waypoints ────────────────────────────────────────────────

interface RouteWaypointDisplay {
  id: string
  role: 'origin' | 'via' | 'destination'
  displayName: string
  time: Date | null
  place?: Partial<Place> | null
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
      place: (wp as any).place ?? null,
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

interface TimelinePlaceStopEntry {
  kind: 'place-stop'
  place: Place
  label: string
  time: Date | null
}

type TimelineEntry = TimelineWaypointEntry | TimelineSegmentEntry | TimelinePlaceStopEntry

const timelineEntries = computed<TimelineEntry[]>(() => {
  const t = trip.value
  if (!t) return []
  const entries: TimelineEntry[] = []
  const wps = routeWaypoints.value
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]

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

    // Check for a place-bearing intermediate waypoint (e.g. parking) between
    // consecutive segments. The backend attaches a full Place object to the
    // segment end waypoint when it represents an OSM POI like a bike rack.
    const seg = segs[i]
    const nextSeg = segs[i + 1]
    if (nextSeg && seg.end?.place) {
      entries.push({
        kind: 'place-stop',
        place: seg.end.place as Place,
        label: seg.end.label || seg.end.place.name?.value || 'Stop',
        time: seg.endTime ?? null,
      })
    }

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

/**
 * Get inline style for rail color — uses transit line color when available,
 * otherwise returns empty (falls back to class-based coloring).
 */
function getRailStyle(entryIndex: number, position: 'above' | 'below'): Record<string, string> {
  const entries = timelineEntries.value
  const search = position === 'above' ? -1 : 1
  for (let j = entryIndex + search; j >= 0 && j < entries.length; j += search) {
    const e = entries[j]
    if (e.kind === 'segment' && e.segment.lineColor) {
      return { background: `#${e.segment.lineColor}` }
    }
    if (e.kind === 'segment') return {}
  }
  return {}
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
              {{ formatCo2(trip.co2Emissions) }} CO₂
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
          :key="entry.kind === 'waypoint' ? entry.wp.id : entry.kind === 'place-stop' ? `place-${entry.place.id}` : `seg-${entry.segmentIndex}`"
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

            <!-- ── Place stop rail (parking, etc.) ── -->
            <template v-else-if="entry.kind === 'place-stop'">
              <!-- Line above icon: from top (overlap) to icon center (mt-0.5=2px + 10px half of 20px = 12px) -->
              <div
                v-if="i > 0"
                class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[-2px] h-[14px]"
                :class="getRailColor(i, 'above')"
                :style="getRailStyle(i, 'above')"
              />
              <!-- Line below icon -->
              <div
                v-if="i < timelineEntries.length - 1"
                class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[12px] bottom-[-2px]"
                :class="getRailColor(i, 'below')"
                :style="getRailStyle(i, 'below')"
              />
              <!-- POI icon -->
              <ItemIcon
                :icon="getSearchResultIconName(entry.place)"
                :icon-pack="getSearchResultIconPack(entry.place)"
                :custom-color="getCategoryColor(getSearchResultCategory(entry.place), themeStore.isDark)"
                size="xs"
                variant="solid"
                shape="circle"
                class="relative z-10 mt-0.5 !size-5 shrink-0"
              />
            </template>

            <!-- ── Segment rail ── -->
            <template v-else-if="entry.kind === 'segment'">
              <!-- Line above icon: previous segment's color, from top (with overlap) to icon center -->
              <div
                class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[-2px] h-[21px]"
                :class="getRailColor(i, 'above')"
                :style="getRailStyle(i, 'above')"
              />
              <!-- Line below icon: this segment's color, from icon center to bottom (with overlap) -->
              <div
                v-if="i < timelineEntries.length - 1"
                class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[19px] bottom-[-2px]"
                :class="!entry.segment.lineColor && (modeColors[entry.segment.mode as keyof typeof modeColors] || 'bg-parchment-500')"
                :style="entry.segment.lineColor ? { background: `#${entry.segment.lineColor}` } : {}"
              />
              <!-- Mode icon — mt-[5px] centers 28px icon against ~38px header (title + subtitle) -->
              <div
                class="relative z-10 mt-[5px] shrink-0 size-7 rounded-full flex items-center justify-center text-white"
                :class="!entry.segment.lineColor && (modeColors[entry.segment.mode as keyof typeof modeColors] || 'bg-parchment-500')"
                :style="entry.segment.lineColor ? {
                  background: `#${entry.segment.lineColor}`,
                  color: entry.segment.lineTextColor ? `#${entry.segment.lineTextColor}` : '#fff',
                } : {}"
              >
                <component
                  :is="getSegmentIcon(entry.segment.mode, entry.segment.routeType)"
                  class="size-3.5"
                />
              </div>
            </template>
          </div>

          <!-- Content column -->
          <div
            class="flex-1 min-w-0 pr-4"
            :class="entry.kind === 'place-stop' ? 'pl-3 pb-4' : entry.kind === 'waypoint' ? 'pl-3 pb-4' : 'pl-2.5 pb-5'"
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
              <!-- Place info card for origin/destination/via with a real POI -->
              <router-link
                v-if="entry.wp.place?.id"
                :to="getPlaceRoute(entry.wp.place.id)"
                class="mt-1.5 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors"
              >
                <ItemIcon
                  :icon="getSearchResultIconName(entry.wp.place as Place)"
                  :icon-pack="getSearchResultIconPack(entry.wp.place as Place)"
                  :custom-color="getCategoryColor(getSearchResultCategory(entry.wp.place as Place), themeStore.isDark)"
                  size="xs"
                  variant="ghost"
                  shape="circle"
                  class="shrink-0"
                />
                <div class="flex-1 min-w-0 flex flex-col">
                  <span
                    v-if="entry.wp.place.placeType?.value"
                    class="text-xs text-muted-foreground leading-snug"
                  >
                    {{ entry.wp.place.placeType.value }}
                  </span>
                  <span
                    v-if="(entry.wp.place as any).summary"
                    class="text-xs text-muted-foreground leading-snug"
                  >
                    {{ (entry.wp.place as any).summary }}
                  </span>
                </div>
              </router-link>
            </template>

            <!-- ═══ Place stop content (parking, etc.) ═══ -->
            <template v-else-if="entry.kind === 'place-stop'">
              <div class="flex items-baseline gap-2 min-h-5 mt-px">
                <span
                  v-if="entry.time"
                  class="text-sm font-medium tabular-nums shrink-0"
                >
                  {{ formatTime(entry.time) }}
                </span>
                <router-link
                  :to="getPlaceRoute(entry.place.id)"
                  class="text-sm text-primary hover:underline truncate"
                >
                  {{ entry.label }}
                </router-link>
              </div>
              <div
                v-if="(entry.place as any).summary || entry.place.placeType?.value"
                class="mt-0.5 flex flex-col gap-0.5"
              >
                <span
                  v-if="entry.place.placeType?.value && entry.place.placeType.value !== entry.label"
                  class="text-xs text-muted-foreground"
                >
                  {{ entry.place.placeType.value }}
                </span>
                <span
                  v-if="(entry.place as any).summary"
                  class="text-xs text-muted-foreground"
                >
                  {{ (entry.place as any).summary }}
                </span>
              </div>
            </template>

            <!-- ═══ Segment content ═══ -->
            <template v-else-if="entry.kind === 'segment'">
              <!-- ── Transit segment header ── -->
              <div v-if="entry.segment.mode === 'transit' && entry.segment.lineName">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    class="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-md text-[11px] font-bold"
                    :style="{
                      background: entry.segment.lineColor ? `#${entry.segment.lineColor}` : undefined,
                      color: entry.segment.lineTextColor ? `#${entry.segment.lineTextColor}` : '#fff',
                    }"
                    :class="!entry.segment.lineColor && 'bg-parchment-500'"
                  >
                    {{ entry.segment.lineName }}
                  </span>
                  <span v-if="entry.segment.headsign" class="text-sm font-semibold text-foreground">
                    {{ entry.segment.headsign }}
                  </span>
                  <span v-else-if="entry.segment.lineLongName" class="text-sm font-semibold text-foreground">
                    {{ entry.segment.lineLongName }}
                  </span>
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
                  <span class="inline-flex items-center gap-1">
                    <ClockIcon class="size-3" />
                    <span
                      v-if="entry.segment.realTimeData && entry.segment.delay && Math.abs(entry.segment.delay) > 60"
                      class="line-through"
                    >{{ formatTime(new Date(entry.segment.startTime.getTime() - entry.segment.delay * 1000)) }}</span>
                    {{ formatTime(entry.segment.startTime) }} – {{ formatTime(entry.segment.endTime) }}
                  </span>
                  <RealtimeIndicator
                    v-if="entry.segment.realTimeData"
                    :real-time="true"
                    :delay="entry.segment.delay"
                    :color="entry.segment.lineColor ? `#${entry.segment.lineColor}` : undefined"
                  />
                  <span>{{ formatDuration(entry.segment.duration) }} · {{ formatDistanceDisplay(entry.segment.distance) }}</span>
                </div>
                <div v-if="entry.segment.agencyName" class="mt-0.5 text-xs text-muted-foreground">
                  {{ entry.segment.agencyName }}
                </div>
                <div v-if="entry.segment.carryingVehicle" class="mt-1 flex items-center gap-1.5 text-xs text-forest-600 dark:text-forest-400">
                  <BikeIcon class="size-3.5" />
                  <span>Bring bike on board</span>
                </div>

                <!-- Board/Alight stops -->
                <div class="mt-2 space-y-1 text-sm">
                  <div v-if="entry.segment.departureStop" class="flex items-center gap-2">
                    <span class="text-[10px] font-semibold text-muted-foreground">Board</span>
                    <span class="text-foreground">{{ entry.segment.departureStop.name }}</span>
                    <span v-if="entry.segment.departureStop.platformCode" class="text-xs text-muted-foreground">
                      Platform {{ entry.segment.departureStop.platformCode }}
                    </span>
                  </div>

                  <!-- Intermediate stops (collapsible) -->
                  <Collapsible
                    v-if="entry.segment.intermediateStops?.length"
                    v-slot="{ open }"
                    class="mt-1"
                  >
                    <CollapsibleTrigger class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                      <ChevronDownIcon class="size-3 transition-transform" :class="open && 'rotate-180'" />
                      <span>{{ entry.segment.intermediateStops.length }} stops</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div class="ml-4 mt-1 space-y-0.5">
                        <div
                          v-for="stop in entry.segment.intermediateStops"
                          :key="stop.id || stop.name"
                          class="flex items-center gap-2 text-xs text-muted-foreground py-0.5"
                        >
                          <span class="size-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                          <span class="flex-1">{{ stop.name }}</span>
                          <span v-if="stop.arrivalTime" class="text-[10px] tabular-nums shrink-0">
                            {{ formatTime(new Date(stop.arrivalTime)) }}
                          </span>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <div v-if="entry.segment.arrivalStop" class="flex items-center gap-2">
                    <span class="text-[10px] font-semibold text-muted-foreground">Alight</span>
                    <span class="text-foreground">{{ entry.segment.arrivalStop.name }}</span>
                    <span v-if="entry.segment.arrivalStop.platformCode" class="text-xs text-muted-foreground">
                      Platform {{ entry.segment.arrivalStop.platformCode }}
                    </span>
                  </div>

                  <!-- Transit alerts -->
                  <div
                    v-for="(alert, ai) in entry.segment.transitDetails?.alerts ?? []"
                    :key="ai"
                    class="flex gap-2 p-2 mt-1 rounded-md text-xs"
                    :class="alert.severity === 'severe'
                      ? 'bg-destructive/10 text-destructive'
                      : alert.severity === 'warning'
                        ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
                        : 'bg-muted text-muted-foreground'"
                  >
                    <AlertTriangleIcon class="size-3.5 shrink-0 mt-0.5" />
                    <div>
                      <div v-if="alert.headerText" class="font-medium">{{ alert.headerText }}</div>
                      <div v-if="alert.descriptionText" class="mt-0.5 line-clamp-3">{{ alert.descriptionText }}</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- ── Non-transit segment header ── -->
              <div v-else>
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
