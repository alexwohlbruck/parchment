<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { api } from '@/lib/api'
import { applyDepartureChange } from '@/lib/trip-rebooking'
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
  CarTaxiFrontIcon,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  BookmarkIcon,
  ChevronDownIcon,
  ClockIcon,
  ExternalLinkIcon,
  FlagIcon,
  FootprintsIcon,
  RssIcon,
  ShareIcon,
  Undo2Icon,
} from 'lucide-vue-next'
import { AppRoute } from '@/router'
import { tripSignature } from '@/lib/trip-signature'
import type { RouteInstruction } from '@/types/directions.types'
import type { Place } from '@/types/place.types'
import type { RouteProfileType } from '@/lib/route-profile-colors'
import type { SharedMobilityDetails } from '@/types/multimodal.types'
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

// ── Upcoming departures per transit segment ─────────────────────────
// Shows the rider their options beyond the planned departure ("also at
// 2:21, 2:51"), Transit-app style. Fetched per boarding stop, filtered to
// the same line and direction. Clicking a later one re-plans the trip
// anchored to that departure.
interface DepartureOption {
  ms: number
  label: string
  /** True when the time comes from a GTFS-RT prediction, not the schedule. */
  realTime: boolean
}
const segmentDepartures = ref<Record<number, DepartureOption[]>>({})
// Full fetched schedule per segment (superset of the chips) — rebooking
// resolves runs from this synchronously, so switching departures is instant.
const segmentSchedule = ref<Record<number, DepartureOption[]>>({})

// Clock driving missed/hurry chip states; departures re-fetch keeps the
// realtime predictions fresh as vehicles move.
const nowMs = ref(Date.now())
const tickTimer = setInterval(() => { nowMs.value = Date.now() }, 10_000)
const refreshTimer = setInterval(() => { void loadDepartures() }, 30_000)
onUnmounted(() => {
  clearInterval(tickTimer)
  clearInterval(refreshTimer)
})

async function loadDepartures() {
  const t = trip.value
  if (!t) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]
  const nextChips: Record<number, DepartureOption[]> = {}
  const nextSched: Record<number, DepartureOption[]> = {}
  await Promise.all(
    segs.map(async (seg, idx) => {
      if (seg.mode !== 'transit' || !seg.departureStop?.location) return
      try {
        const startMs = new Date(seg.startTime).getTime()

        // Earliest run the rider could physically board: mid-trip you can
        // only board out of the existing platform wait (arrival on foot);
        // for the first boarding, leaving home earlier is bounded by the
        // requested departure time (or now).
        const hasEarlierTransit = segs
          .slice(0, idx)
          .some((s) => s.mode === 'transit')
        let floorMs: number
        if (hasEarlierTransit) {
          const prev = segs[idx - 1]
          floorMs = prev?.mode === 'walking'
            ? new Date(prev.endTime).getTime() - (prev.waitSeconds ?? 0) * 1000
            : startMs
        } else {
          const requestedMs = directionsStore.departureTime
            ? new Date(directionsStore.departureTime).getTime()
            : Date.now()
          floorMs = requestedMs + (startMs - new Date(t.startTime).getTime())
        }

        const { data } = await api.get('/proxy/transit/departures', {
          params: {
            lat: seg.departureStop.location.lat,
            lng: seg.departureStop.location.lng,
            radius: 50,
            n: 60,
            time: new Date(Math.min(floorMs, startMs) - 60_000).toISOString(),
          },
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const all: any[] = (Array.isArray(data) ? data : []).flatMap(
          (s: { departures?: unknown[] }) => s.departures ?? [],
        )
        const sameLine = all.filter(
          (d) => d.route?.shortName === seg.lineName && !d.cancelled,
        )
        // Prefer same-direction departures when the headsign matches
        const sameDirection = sameLine.filter(
          (d) => d.headsign?.toLowerCase() === seg.headsign?.toLowerCase(),
        )
        const pool = sameDirection.length >= 2 ? sameDirection : sameLine
        // Dedup by minute; a run is "live" when any source row carries a
        // GTFS-RT prediction for it.
        const byMs = new Map<number, boolean>()
        for (const d of pool) {
          const depMs = new Date(d.departureTime).getTime()
          if (depMs < floorMs - 30_000) continue
          byMs.set(depMs, (byMs.get(depMs) ?? false) || d.realTime === true)
        }
        const runs: DepartureOption[] = [...byMs.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([ms, realTime]) => ({ ms, realTime, label: formatTime(new Date(ms)) }))
        nextSched[idx] = runs
        const earlier = runs.filter((d) => d.ms < startMs - 30_000).slice(-2)
        const current = runs.filter((d) => d.ms >= startMs - 30_000).slice(0, 4)
        nextChips[idx] = [...earlier, ...current]
      } catch {
        // Departures are an enhancement — skip on failure
      }
    }),
  )
  // Atomic swap — no flicker on the periodic refresh
  segmentDepartures.value = nextChips
  segmentSchedule.value = nextSched
}

/** Is this run the one the trip currently boards? */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isCurrentDeparture(segment: any, ms: number): boolean {
  return Math.abs(ms - asMs(segment.startTime)) < 30_000
}

function departuresFor(segmentIndex: number): DepartureOption[] {
  return segmentDepartures.value[segmentIndex] ?? []
}

// ── Departure rebooking ──────────────────────────────────────────────
// Choosing a later run is pure schedule math on the existing plan — no
// re-planning. The chosen leg moves to the chosen run; legs before it
// either shift later (first boarding: leave home later) or keep their
// schedule with the extra wait absorbed at the platform; legs after keep
// their planned runs when the connection still holds, otherwise roll to
// the next departure of the same line.
const rebooking = ref(false)

function asMs(v: string | Date): number {
  return new Date(v).getTime()
}

/** Next run of this segment's line departing at/after minMs. Resolves from
 *  the prefetched schedule (instant); only goes to the API when the needed
 *  run falls outside the cached window. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextDepartureAfter(seg: any, segmentIndex: number, minMs: number): Promise<number | null> {
  const cached = (segmentSchedule.value[segmentIndex] ?? []).find((d) => d.ms >= minMs)
  if (cached) return cached.ms
  try {
    const { data } = await api.get('/proxy/transit/departures', {
      params: {
        lat: seg.departureStop.location.lat,
        lng: seg.departureStop.location.lng,
        radius: 50,
        n: 20,
        time: new Date(minMs).toISOString(),
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = (Array.isArray(data) ? data : []).flatMap(
      (s: { departures?: unknown[] }) => s.departures ?? [],
    )
    return (
      all
        .filter((d) => d.route?.shortName === seg.lineName && !d.cancelled)
        .map((d) => new Date(d.departureTime).getTime())
        .filter((m) => m >= minMs)
        .sort((a, b) => a - b)[0] ?? null
    )
  } catch {
    return null
  }
}

async function chooseDeparture(segmentIndex: number, departureMs: number) {
  const t = trip.value
  if (!t || rebooking.value) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]

  rebooking.value = true
  try {
    const changed = await applyDepartureChange(
      segs,
      segmentIndex,
      departureMs,
      (i, minMs) => nextDepartureAfter(segs[i], i, minMs),
    )
    if (!changed) return

    // Trip-level rollup
    t.startTime = new Date(asMs(segs[0].startTime))
    t.endTime = new Date(asMs(segs[segs.length - 1].endTime))
    t.summary.totalDuration = (asMs(t.endTime) - asMs(t.startTime)) / 1000

    // Refresh chips in the background — the rebooking math is already
    // applied from the cached schedule, so the UI updates instantly.
    void loadDepartures()
  } finally {
    rebooking.value = false
  }
}

// ── Departure chip states (Transit-app style) ────────────────────────
// missed: the vehicle is gone (or, for the first boarding, you can no
// longer walk there in time). hurry: catchable, but only just — the walk
// leaves under 3 minutes of slack. live: time comes from GTFS-RT.

/** Walking seconds from the rider's position to this boarding, when this
 *  is the trip's first transit leg (0 otherwise — mid-trip positions
 *  depend on earlier legs, so only "departed" can be judged there). */
function accessWalkSec(segmentIndex: number): number {
  const t = trip.value
  if (!t) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]
  const isFirst = !segs.slice(0, segmentIndex).some((s) => s.mode === 'transit')
  if (!isFirst) return 0
  const prev = segs[segmentIndex - 1]
  return prev?.mode === 'walking' ? movingDuration(prev) : 0
}

function depState(segmentIndex: number, dep: DepartureOption): 'missed' | 'hurry' | 'ok' {
  const leadMs = dep.ms - nowMs.value
  const walkMs = accessWalkSec(segmentIndex) * 1000
  if (leadMs < walkMs) return 'missed'
  if (walkMs > 0 && leadMs < walkMs + 180_000) return 'hurry'
  return 'ok'
}

/** Time actually in motion — a walk's duration minus the wait at the stop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function movingDuration(segment: any): number {
  return Math.max(0, (segment.duration || 0) - (segment.waitSeconds ?? 0))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function waitMinutes(segment: any): number {
  const w = segment.waitSeconds ?? 0
  return w >= 60 ? Math.round(w / 60) : 0
}

const hoveredInstructionKey = ref<string | null>(null)

const tripId = computed(() => route.params.id as string)
const isLoading = ref(false)
const error = ref<string | null>(null)

// Trip lookup: exact id first (same session / restored plan cache), then
// the URL's stable signature — a refresh or shared link re-plans from the
// URL's wp/mode/depart params (the shared directions service hydrates and
// fetches automatically) and the signature picks this trip out of the
// fresh results, whose ids are newly minted.
const trip = computed(() => {
  const list = directionsStore.trips?.trips
  if (!list) return null
  const byId = list.find(t => t.id === tripId.value)
  if (byId) return byId
  const sig = route.query.sig as string | undefined
  if (!sig) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return list.find(t => tripSignature((t as any).segments) === sig) || null
})

watch(trip, loadDepartures, { immediate: true })

// Keep the URL's id canonical after a signature match, so departure
// rebooking and further shares reference the live trip object.
watch(trip, (t) => {
  if (t && t.id !== tripId.value) {
    router.replace({ params: { id: t.id }, query: route.query }).catch(() => {})
  }
})

// Only bail back to the planner when results have settled and the trip is
// genuinely absent — never mid-recovery while the re-plan is in flight.
watch(
  [trip, () => directionsStore.isLoading],
  ([newTrip, loading]) => {
    if (newTrip === null && !loading && directionsStore.trips) {
      router.push({ name: AppRoute.DIRECTIONS, query: route.query })
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

type RentalPricing = NonNullable<SharedMobilityDetails['pricing']>

/** "≈ $12.12" — estimated single-ride fare. */
const formatRentalFare = (p: RentalPricing): string =>
  `≈ ${formatCurrency({ currency: p.currency, amount: p.estimatedCost })}`

/** "$4.99 unlock + $0.41/min" — the rate card behind the estimate. */
const formatFareBreakdown = (p: RentalPricing): string => {
  const unlock = `${formatCurrency({ currency: p.currency, amount: p.unlockPrice })} unlock`
  if (p.perMinuteRate > 0) {
    const rate = formatCurrency({ currency: p.currency, amount: p.perMinuteRate })
    return `${unlock} + ${rate}/min`
  }
  return unlock
}

function formatCo2(kg: number): string {
  if (kg >= 1) return `${kg.toFixed(1)} kg`
  return `${Math.round(kg * 1000)} g`
}


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
    <!-- Loading (own state, or the shared planner re-creating the trip
         from a refreshed/shared URL) -->
    <div v-if="isLoading || (!trip && directionsStore.isLoading)" class="flex items-center justify-center py-8">
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

          <!-- Leave – arrive -->
          <div class="mt-1 text-sm text-muted-foreground tabular-nums">
            {{ formatTime(trip.startTime) }} – {{ formatTime(trip.endTime) }}
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
              <!-- ── Transit segment card ── -->
              <div v-if="entry.segment.mode === 'transit' && entry.segment.lineName">
                <div class="rounded-xl border bg-card overflow-hidden">
                  <!-- Line header — tinted with the line colour -->
                  <div
                    class="px-3 py-2 flex items-center gap-2"
                    :class="!entry.segment.lineColor && 'bg-muted/40'"
                    :style="entry.segment.lineColor ? { background: `#${entry.segment.lineColor}1f` } : {}"
                  >
                    <span
                      class="inline-flex items-center justify-center min-w-[28px] h-[26px] px-2 rounded-lg text-sm font-bold shrink-0"
                      :class="!entry.segment.lineColor && 'bg-parchment-500 text-white'"
                      :style="entry.segment.lineColor ? {
                        background: `#${entry.segment.lineColor}`,
                        color: entry.segment.lineTextColor ? `#${entry.segment.lineTextColor}` : '#fff',
                      } : {}"
                    >
                      {{ entry.segment.lineName }}
                    </span>
                    <ArrowRight class="size-3.5 text-muted-foreground shrink-0" />
                    <span class="text-sm font-semibold text-foreground truncate">
                      {{ entry.segment.headsign || entry.segment.lineLongName }}
                    </span>
                    <RealtimeIndicator
                      v-if="entry.segment.realTimeData"
                      :real-time="true"
                      :delay="entry.segment.delay"
                      :color="entry.segment.lineColor ? `#${entry.segment.lineColor}` : undefined"
                      class="ml-auto shrink-0"
                    />
                  </div>

                  <div class="px-3 py-2.5 space-y-2">
                    <!-- Board -->
                    <div v-if="entry.segment.departureStop" class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-sm font-medium text-foreground leading-snug">
                          {{ entry.segment.departureStop.name }}
                        </div>
                        <div class="text-[11px] text-muted-foreground mt-px">
                          Board<span v-if="entry.segment.departureStop.platformCode"> · Platform {{ entry.segment.departureStop.platformCode }}</span>
                        </div>
                      </div>
                      <span class="text-sm font-semibold tabular-nums shrink-0">
                        {{ formatTime(entry.segment.startTime) }}
                      </span>
                    </div>

                    <!-- Departure picker — tap a later run to re-plan around it -->
                    <div
                      v-if="departuresFor(entry.segmentIndex).length > 1"
                      class="flex flex-wrap items-center gap-1.5"
                    >
                      <button
                        v-for="dep in departuresFor(entry.segmentIndex)"
                        :key="dep.ms"
                        type="button"
                        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium tabular-nums transition-all"
                        :class="[
                          isCurrentDeparture(entry.segment, dep.ms)
                            ? (!entry.segment.lineColor && 'bg-parchment-500 text-white')
                            : depState(entry.segmentIndex, dep) === 'missed'
                              ? 'bg-muted/60 text-muted-foreground/50 line-through cursor-default'
                              : depState(entry.segmentIndex, dep) === 'hurry'
                                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 hover:ring-1 hover:ring-amber-400 cursor-pointer'
                                : 'bg-muted text-muted-foreground hover:text-foreground hover:ring-1 hover:ring-border cursor-pointer',
                          rebooking && 'opacity-50 pointer-events-none',
                        ]"
                        :style="isCurrentDeparture(entry.segment, dep.ms) && entry.segment.lineColor ? {
                          background: `#${entry.segment.lineColor}`,
                          color: entry.segment.lineTextColor ? `#${entry.segment.lineTextColor}` : '#fff',
                        } : {}"
                        :title="isCurrentDeparture(entry.segment, dep.ms)
                          ? 'Planned departure'
                          : depState(entry.segmentIndex, dep) === 'missed'
                            ? 'Departed'
                            : depState(entry.segmentIndex, dep) === 'hurry'
                              ? 'Catchable if you hurry'
                              : 'Take this departure instead'"
                        :disabled="depState(entry.segmentIndex, dep) === 'missed' && !isCurrentDeparture(entry.segment, dep.ms)"
                        @click="!isCurrentDeparture(entry.segment, dep.ms)
                          && depState(entry.segmentIndex, dep) !== 'missed'
                          && chooseDeparture(entry.segmentIndex, dep.ms)"
                      >
                        <!-- Live (GTFS-RT) vs scheduled indicator -->
                        <RssIcon
                          v-if="dep.realTime"
                          class="size-2.5 opacity-70"
                          :class="depState(entry.segmentIndex, dep) !== 'missed' && 'animate-pulse'"
                        />
                        {{ dep.label }}
                      </button>
                    </div>

                    <!-- Intermediate stops -->
                    <Collapsible
                      v-if="entry.segment.intermediateStops?.length"
                      v-slot="{ open }"
                    >
                      <CollapsibleTrigger class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                        <ChevronDownIcon class="size-3 transition-transform" :class="open && 'rotate-180'" />
                        <span>{{ entry.segment.intermediateStops.length }} stops · {{ formatDuration(entry.segment.duration) }}</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div
                          class="ml-1.5 mt-1.5 pl-3 space-y-1 border-l-2"
                          :style="entry.segment.lineColor ? { borderColor: `#${entry.segment.lineColor}66` } : {}"
                        >
                          <div
                            v-for="stop in entry.segment.intermediateStops"
                            :key="stop.id || stop.name"
                            class="flex items-center gap-2 text-xs text-muted-foreground"
                          >
                            <span class="flex-1 truncate">{{ stop.name }}</span>
                            <span v-if="stop.arrivalTime" class="text-[10px] tabular-nums shrink-0">
                              {{ formatTime(new Date(stop.arrivalTime)) }}
                            </span>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <!-- Alight -->
                    <div v-if="entry.segment.arrivalStop" class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-sm font-medium text-foreground leading-snug">
                          {{ entry.segment.arrivalStop.name }}
                        </div>
                        <div class="text-[11px] text-muted-foreground mt-px">
                          Alight<span v-if="entry.segment.arrivalStop.platformCode"> · Platform {{ entry.segment.arrivalStop.platformCode }}</span>
                        </div>
                      </div>
                      <span class="text-sm font-semibold tabular-nums shrink-0">
                        {{ formatTime(entry.segment.endTime) }}
                      </span>
                    </div>

                    <!-- Transit alerts -->
                    <div
                      v-for="(alert, ai) in entry.segment.transitDetails?.alerts ?? []"
                      :key="ai"
                      class="flex gap-2 p-2 rounded-md text-xs"
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

                <!-- Meta under the card -->
                <div class="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span class="tabular-nums">{{ formatDuration(entry.segment.duration) }} · {{ formatDistanceDisplay(entry.segment.distance) }}</span>
                  <span v-if="entry.segment.agencyName">· {{ entry.segment.agencyName }}</span>
                  <span
                    v-if="entry.segment.carryingVehicle"
                    class="inline-flex items-center gap-1 text-forest-600 dark:text-forest-400"
                  >
                    <BikeIcon class="size-3" /> Bring bike on board
                  </span>
                </div>
              </div>

              <!-- ── Rideshare segment header ── -->
              <div v-else-if="entry.segment.mode === 'rideshare' && entry.segment.rideshareDetails">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span class="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <CarTaxiFrontIcon class="size-4" />
                    {{ entry.segment.rideshareDetails.provider }}
                    <span v-if="entry.segment.rideshareDetails.productName" class="font-normal text-muted-foreground">
                      {{ entry.segment.rideshareDetails.productName }}
                    </span>
                  </span>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span v-if="entry.segment.rideshareDetails.priceRange" class="font-semibold text-foreground">
                    ${{ entry.segment.rideshareDetails.priceRange.low.value.toFixed(0) }}–${{ entry.segment.rideshareDetails.priceRange.high.value.toFixed(0) }}
                  </span>
                  <span v-if="entry.segment.rideshareDetails.surgeMultiplier && entry.segment.rideshareDetails.surgeMultiplier > 1"
                    class="text-amber-500 font-medium"
                  >
                    {{ entry.segment.rideshareDetails.surgeMultiplier.toFixed(1) }}× surge
                  </span>
                  <span v-if="entry.segment.rideshareDetails.pickupEta" class="inline-flex items-center gap-1">
                    <ClockIcon class="size-3" />
                    {{ Math.ceil(entry.segment.rideshareDetails.pickupEta / 60) }} min pickup
                  </span>
                  <span>{{ formatDuration(entry.segment.duration) }}</span>
                </div>
                <a
                  v-if="entry.segment.rideshareDetails.bookingUrl"
                  :href="entry.segment.rideshareDetails.bookingUrl"
                  target="_blank"
                  class="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Book in {{ entry.segment.rideshareDetails.provider }} →
                </a>
              </div>

              <!-- ── Non-transit segment header ── -->
              <div v-else>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    :class="[
                      'text-sm font-semibold capitalize',
                      modeTextColors[entry.segment.mode] || 'text-foreground',
                    ]"
                  >
                    {{ entry.segment.ownership === 'shared'
                      ? (entry.segment.sharedMobilityDetails?.vehicleType === 'scooter' ? 'Scootershare' : 'Bikeshare')
                      : entry.segment.mode }}
                  </span>
                  <span
                    v-if="entry.segment.ownership === 'shared'"
                    class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300"
                  >
                    Shared
                  </span>
                  <span class="text-sm text-muted-foreground">
                    {{ formatDuration(movingDuration(entry.segment)) }} · {{ formatDistanceDisplay(entry.segment.distance) }}
                  </span>
                </div>
                <!-- Walk times are implied by the surrounding stops; show the
                     clock only for vehicle modes -->
                <div
                  v-if="entry.segment.mode !== 'walking' && entry.segment.startTime && entry.segment.endTime"
                  class="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums"
                >
                  <ClockIcon class="size-3" />
                  {{ formatTime(entry.segment.startTime) }} – {{ formatTime(entry.segment.endTime) }}
                </div>
                <div
                  v-if="waitMinutes(entry.segment)"
                  class="mt-0.5 text-xs text-muted-foreground"
                >
                  then wait {{ waitMinutes(entry.segment) }} min
                </div>
              </div>

              <!-- Shared mobility station info -->
              <div
                v-if="entry.segment.sharedMobilityDetails"
                class="mt-2 rounded-lg border bg-teal-50 dark:bg-teal-900/20 p-3 space-y-2"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <div v-if="entry.segment.sharedMobilityDetails.stationName" class="text-sm font-medium">
                      {{ entry.segment.sharedMobilityDetails.stationName }}
                      <template v-if="entry.segment.sharedMobilityDetails.toStationName">
                        <ArrowRight class="inline size-3 mx-0.5 text-muted-foreground" />
                        {{ entry.segment.sharedMobilityDetails.toStationName }}
                      </template>
                    </div>
                    <div class="text-xs text-muted-foreground">
                      {{ entry.segment.sharedMobilityDetails.provider }}
                      <span v-if="entry.segment.sharedMobilityDetails.propulsionType === 'electric_assist'"> · e-bike</span>
                    </div>
                  </div>
                  <div
                    v-if="entry.segment.sharedMobilityDetails.availableVehicles != null"
                    class="text-xs text-teal-700 dark:text-teal-300 font-medium"
                  >
                    {{ entry.segment.sharedMobilityDetails.availableVehicles }} available
                  </div>
                </div>
                <!-- GBFS fare estimate -->
                <div
                  v-if="entry.segment.sharedMobilityDetails.pricing"
                  class="flex items-baseline justify-between gap-2 border-t border-teal-200/60 dark:border-teal-800/40 pt-2"
                >
                  <span class="text-sm font-semibold text-teal-800 dark:text-teal-200">
                    {{ formatRentalFare(entry.segment.sharedMobilityDetails.pricing) }}
                  </span>
                  <span class="text-xs text-muted-foreground text-right">
                    {{ formatFareBreakdown(entry.segment.sharedMobilityDetails.pricing) }}
                  </span>
                </div>
                <a
                  v-if="entry.segment.sharedMobilityDetails.unlockUri"
                  :href="entry.segment.sharedMobilityDetails.unlockUri"
                  target="_blank"
                  rel="noopener"
                  class="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors"
                >
                  Unlock in {{ entry.segment.sharedMobilityDetails.provider }}
                  <ExternalLinkIcon class="size-3.5" />
                </a>
              </div>

              <!-- Details: stats, elevation, turn-by-turn — folded by default
                   so the whole trip fits on one screen -->
              <Collapsible
                v-if="hasSegmentRouteInfo(entry.segment) || entry.segment.instructions?.length"
                v-slot="{ open }"
                class="mt-2"
              >
                <CollapsibleTrigger
                  class="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <ChevronDownIcon class="size-3 transition-transform" :class="open && 'rotate-180'" />
                  <span>{{ open ? 'Hide details' : 'Details' }}</span>
                  <span
                    v-if="!open && entry.segment.instructions?.length"
                    class="font-normal text-muted-foreground/70"
                  >· {{ entry.segment.instructions.length }} steps</span>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <!-- Stats + elevation -->
                  <div
                    v-if="hasSegmentRouteInfo(entry.segment)"
                    class="mt-2 rounded-lg border bg-card p-3.5 space-y-3"
                  >
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
                  <div v-if="entry.segment.instructions?.length" class="mt-2">
                    <div
                      v-for="(instruction, instrIndex) in entry.segment.instructions"
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
                </CollapsibleContent>
              </Collapsible>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- No trip found — and no way to recreate it (the URL carries no
         planning inputs). Recoverable URLs never land here: the shared
         service re-plans from the query and the signature re-finds the trip. -->
    <div v-else class="p-6 flex flex-col items-start gap-3">
      <Caption>This trip is no longer available.</Caption>
      <Button variant="outline" size="sm" @click="router.push({ name: AppRoute.DIRECTIONS, query: route.query })">
        <ArrowLeft class="size-4 mr-1" />
        Back to the planner
      </Button>
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
