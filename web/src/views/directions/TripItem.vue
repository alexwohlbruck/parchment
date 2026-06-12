<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import { useI18n } from 'vue-i18n'
import { useMapService } from '@/services/map.service'
import { useUnits } from '@/composables/useUnits'
import { getTravelModeCssClass, getTravelModeColor } from '@/lib/travel-mode-colors'
import { getSegmentIcon, getModeIcon } from '@/lib/travel-mode-icons'
import type {
  TripOption,
  TripsResponse,
} from '@/types/directions.types'

interface Props {
  trip: TripOption
  tripRequest: TripsResponse['request']
  timelineStart: Date
  pxPerMinute: number
  sidebarWidth: number
  isClickable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isClickable: true,
})

const emit = defineEmits<{
  click: [trip: TripOption]
}>()

const mapService = useMapService()
const { t } = useI18n()
const { formatDistance } = useUnits()

function formatCo2(kg: number): string {
  if (kg >= 1) return `${kg.toFixed(1)} kg`
  return `${Math.round(kg * 1000)} g`
}

/**
 * Trip type — the combination pattern, not the longest mode. A subway trip
 * with two long walks is still a transit trip ("Transit & Walking"), a
 * drive to the station is "Park & Ride". Mirrors the trip-combination
 * taxonomy the planner generates from.
 */
const tripType = computed<{ key: string; iconMode: string }>(() => {
  const segs = props.trip.segments as any[]
  const has = (m: string) => segs.some(s => s.mode === m)

  if (!has('transit')) {
    if (has('rideshare')) return { key: 'rideshare', iconMode: 'rideshare' }
    if (has('driving')) return { key: 'driving', iconMode: 'driving' }
    if (has('cycling')) return { key: 'cycling', iconMode: 'cycling' }
    if (has('wheelchair')) return { key: 'wheelchair', iconMode: 'wheelchair' }
    return { key: 'walking', iconMode: 'walking' }
  }

  if (has('driving')) return { key: 'parkAndRide', iconMode: 'transit' }
  if (has('rideshare')) return { key: 'transitRideshare', iconMode: 'transit' }
  const shared = segs.find(s => s.sharedMobilityDetails)
  if (shared) {
    const kind = shared.sharedMobilityDetails?.vehicleType === 'scooter'
      ? 'transitScooter' : 'transitBikeShare'
    return { key: kind, iconMode: 'transit' }
  }
  if (has('cycling')) return { key: 'transitBike', iconMode: 'transit' }

  // Significant walking: ≥8 min actually moving, or over a third of the trip
  const walkSec = segs.reduce(
    (sum, s) => sum + (s.mode === 'walking' ? (s.duration || 0) - (s.waitSeconds ?? 0) : 0),
    0,
  )
  const total = props.trip.summary.totalDuration || 1
  if (walkSec >= 480 || walkSec / total >= 0.35) {
    return { key: 'transitWalking', iconMode: 'transit' }
  }
  return { key: 'transit', iconMode: 'transit' }
})

/** Icon for the trip type — transit types use the longest transit segment's route type */
const tripIcon = computed(() => {
  if (tripType.value.iconMode !== 'transit') {
    return getModeIcon(tripType.value.iconMode)
  }
  let longestSeg: any = null
  let longestDur = 0
  for (const seg of props.trip.segments) {
    if (seg.mode === 'transit' && seg.duration > longestDur) {
      longestDur = seg.duration
      longestSeg = seg
    }
  }
  return getSegmentIcon('transit', longestSeg?.routeType)
})

function segLeft(segment: { startTime: Date }) {
  return dayjs(segment.startTime).diff(props.timelineStart, 'minute', true) * props.pxPerMinute
}

function segEnd(segment: { endTime?: Date; startTime: Date; duration: number }) {
  const end = segment.endTime ?? dayjs(segment.startTime).add(segment.duration, 'second').toDate()
  return dayjs(end).diff(props.timelineStart, 'minute', true) * props.pxPerMinute
}

function segW(segment: { duration: number }) {
  return Math.max((segment.duration / 60) * props.pxPerMinute, 4)
}

/** Waits shorter than this aren't worth a visual break in the ticks. */
const MIN_WAIT_SEC = 30

/**
 * Typed sub-spans of the track: 'walk' (tall ticks) then 'wait' (dots).
 * The split comes from the server's `waitSeconds` — the stop wait folded
 * into a walk segment after its moving portion. No wait field → the whole
 * segment is walking (e.g. pure walking trips).
 */
const trackSpans = computed(() => {
  const pxPerSec = props.pxPerMinute / 60
  const spans: { left: number; width: number; type: 'walk' | 'wait' }[] = []
  for (const seg of props.trip.segments) {
    if (seg.mode !== 'walking') continue
    const dur = seg.duration || 0
    if (dur <= 0) continue
    const left = segLeft(seg)
    const waitSec = (seg as { waitSeconds?: number }).waitSeconds ?? 0
    const walkSec = waitSec >= MIN_WAIT_SEC ? dur - waitSec : dur
    const walkW = walkSec * pxPerSec
    if (walkW > 0.5) spans.push({ left, width: walkW, type: 'walk' })
    if (walkSec < dur) {
      spans.push({ left: left + walkW, width: (dur - walkSec) * pxPerSec, type: 'wait' })
    }
  }
  return spans
})

// Walk and wait share colour, opacity, and spacing — the shape is the
// signal: walking is a tall pill tick, waiting a small dot. Crisp pill
// shapes come from an SVG mask (gradients anti-alias into blurry ovals);
// the colour is a plain background that shows through the mask.
//
// Each tick represents one minute: a span gets round(minutes) shapes, and
// the tile is fitted so that whole number fills it exactly — countable
// minutes, no clipped pills at span boundaries.
const TICK_COLOR = 'hsl(var(--muted-foreground) / 0.6)'
const TICK_W = 2.5

function tickStyle(span: { width: number; type: 'walk' | 'wait' }) {
  const h = span.type === 'walk' ? 9 : TICK_W
  const count = Math.max(1, Math.round(span.width / props.pxPerMinute))
  const tile = span.width / count
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${h}"><rect x="${(tile - TICK_W) / 2}" width="${TICK_W}" height="${h}" rx="${TICK_W / 2}"/></svg>`
  const mask = `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') 0 center / ${tile}px ${h}px repeat-x`
  return { backgroundColor: TICK_COLOR, mask, WebkitMask: mask }
}

function getTripModeLabel(mode: string): string {
  const normalizedMode = mode === 'biking' ? 'cycling' : mode
  return t(`directions.modes.${normalizedMode}`)
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return { parts: [{ value: minutes, unit: 'min' }] }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  const parts = [{ value: hours, unit: 'h' }]
  if (remainingMinutes > 0) parts.push({ value: remainingMinutes, unit: 'm' })
  return { parts }
}

function formatDurationString(seconds: number) {
  const { parts } = formatDuration(seconds)
  return parts.map(p => `${p.value}${p.unit}`).join(' ')
}

function getArrivalTime() {
  const lastSegment = props.trip.segments[props.trip.segments.length - 1]
  if (!lastSegment) return ''
  return new Date(lastSegment.endTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function getSegmentTooltip(segment: any): string {
  const duration = formatDurationString(segment.duration)
  const distance = segment.distance ? formatDistance(segment.distance) : ''
  const mode = getTripModeLabel(segment.mode)
  return `${mode}: ${duration}${distance ? ', ' + distance : ''}`
}

/** "Q · toward Coney Island" — single quiet context line under the bar. */
const firstTransitHeadsign = computed(() => {
  const seg = props.trip.segments.find(s => s.mode === 'transit' && (s as any).headsign)
  if (!seg) return null
  return `${(seg as any).lineName ? (seg as any).lineName + ' · ' : ''}${t('directions.toward', { headsign: (seg as any).headsign })}`
})

const legs = computed(() => {
  const groups: { legIndex: number; segments: typeof props.trip.segments }[] = []
  for (const seg of props.trip.segments) {
    const li = (seg as any).legIndex ?? 0
    const last = groups[groups.length - 1]
    if (last && last.legIndex === li) {
      last.segments.push(seg)
    } else {
      groups.push({ legIndex: li, segments: [seg] })
    }
  }
  return groups
})

// Positions where waypoint caps should appear (leg boundaries only)
const waypointCapPositions = computed(() => {
  const segs = props.trip.segments
  if (!segs.length) return []
  const positions: number[] = [segLeft(segs[0])]
  for (const leg of legs.value) {
    const lastSeg = leg.segments[leg.segments.length - 1]
    positions.push(Math.max(segEnd(lastSeg), segLeft(lastSeg) + segW(lastSeg)))
  }
  return positions
})

// Whether a segment is part of a multimodal leg (different modes within same leg)
function isMultimodal(segment: typeof props.trip.segments[0]): boolean {
  const li = (segment as any).legIndex ?? 0
  const leg = legs.value.find(l => l.legIndex === li)
  if (!leg || leg.segments.length < 2) return false
  return new Set(leg.segments.map(s => s.mode)).size > 1
}

function segLegIndex(segment: typeof props.trip.segments[0]): number {
  return (segment as any).legIndex ?? 0
}

// Walking segments don't render as pills — the dotted track shows through,
// Transit-app style. Pills join only to an adjacent visible (non-walk) pill.
function isPill(segment: typeof props.trip.segments[0]): boolean {
  return segment.mode !== 'walking'
}

function joinsNext(index: number): boolean {
  if (index >= props.trip.segments.length - 1) return false
  const current = props.trip.segments[index]
  const next = props.trip.segments[index + 1]
  return (
    isPill(current) &&
    isPill(next) &&
    segLegIndex(current) === segLegIndex(next) &&
    isMultimodal(current)
  )
}

function joinsPrev(index: number): boolean {
  return index > 0 && joinsNext(index - 1)
}

function handleClick() {
  if (props.isClickable) {
    emit('click', props.trip)
  }
}

function handleMouseEnter() {
  mapService.showTripOnHover(props.trip.id)
}
</script>

<template>
  <div
    class="grid gap-3.5 py-3 transition-colors"
    :class="{ 'cursor-pointer hover:bg-accent/50': isClickable }"
    :style="{ gridTemplateColumns: sidebarWidth ? `${sidebarWidth}px 1fr` : 'auto 1fr' }"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
  >
    <!-- Duration sidebar -->
    <div data-sidebar class="text-right tabular-nums pt-0.5 pl-3 pr-2 whitespace-nowrap">
      <div class="text-base font-semibold leading-tight">
        <template v-for="(part, i) in formatDuration(trip.summary.totalDuration).parts" :key="i">
          <span v-if="i > 0" class="inline-block w-1" />{{ part.value }}<span class="text-[11px] font-medium ml-px">{{ part.unit }}</span>
        </template>
      </div>
      <div class="text-[10px] text-muted-foreground font-medium mt-0.5">
        {{ getArrivalTime() }}
      </div>
      <div class="text-[10px] text-muted-foreground font-medium">
        {{ formatDistance(trip.summary.totalDistance) }}
      </div>
    </div>

    <!-- Bar + meta -->
    <div>
      <!-- Trip bar -->
      <div class="relative h-7 flex items-center">
        <!-- Faint baseline for the empty axis (before departure / after arrival) -->
        <div class="absolute inset-x-0 h-px top-1/2 -translate-y-1/2 bg-border/30" />

        <!-- Track spans: walking as tall pill ticks, waiting as dots -->
        <div
          v-for="(span, i) in trackSpans"
          :key="`track-${i}`"
          class="absolute top-1/2 -translate-y-1/2"
          :class="span.type === 'walk' ? 'h-2.5' : 'h-1.5'"
          :style="{ left: `${span.left}px`, width: `${span.width}px`, ...tickStyle(span) }"
        />

        <!-- Start cap -->
        <div
          class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-2.5 rounded-full bg-background border-[1.5px] border-foreground/60 z-[20] shadow-xs"
          :style="{ left: `${segLeft(trip.segments[0])}px` }"
        />

        <!-- Vehicle pills — walking stays as the dotted track underneath -->
        <template v-for="(segment, i) in trip.segments" :key="segment.id">
          <div
            v-if="isPill(segment)"
            class="absolute h-full flex items-center justify-center text-white top-1/2 -translate-y-1/2 overflow-hidden shadow-xs"
            :class="[
              joinsNext(i) && !joinsPrev(i) ? 'rounded-l-[10px] rounded-r-none'
                : joinsPrev(i) && !joinsNext(i) ? 'rounded-r-[10px] rounded-l-none'
                : joinsPrev(i) && joinsNext(i) ? 'rounded-none'
                : 'rounded-[10px]',
              !segment.lineColor && getTravelModeCssClass(segment.mode),
              segW(segment) > 28 ? 'px-2 gap-1.5' : 'px-0.5',
            ]"
            :style="{
              left: `${segLeft(segment) - (joinsPrev(i) ? 6 : 0)}px`,
              width: `${segW(segment) + (joinsPrev(i) ? 6 : 0)}px`,
              zIndex: i + 1,
              ...(segment.lineColor ? { background: `#${segment.lineColor}`, color: segment.lineTextColor ? `#${segment.lineTextColor}` : '#fff' } : {}),
            }"
            :title="getSegmentTooltip(segment)"
          >
            <span
              v-if="segment.lineName && segW(segment) > 28"
              class="text-[12px] font-bold truncate"
            >
              {{ segment.lineName }}
            </span>
            <component
              v-else-if="segW(segment) > 20"
              :is="getSegmentIcon(segment.mode, segment.routeType)"
              class="size-3.5 shrink-0"
            />
          </div>
        </template>

        <!-- End cap -->
        <div
          v-if="waypointCapPositions.length"
          class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-2.5 rounded-full bg-primary border-[1.5px] border-white z-[20] shadow-xs"
          :style="{ left: `${waypointCapPositions[waypointCapPositions.length - 1]}px` }"
        />
        <!-- Intermediate waypoint caps (multi-stop trips only) -->
        <div
          v-for="(pos, i) in waypointCapPositions.slice(1, -1)"
          :key="`cap-${i}`"
          class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-2 rounded-full bg-background border-[1.5px] border-primary z-[20]"
          :style="{ left: `${pos}px` }"
        />
      </div>

      <!-- Trip meta -->
      <div class="flex items-center gap-1.5 flex-wrap mt-1.5 pr-4 text-[11px] text-muted-foreground">
        <span class="inline-flex items-center gap-1">
          <component
            :is="tripIcon"
            class="size-3"
            :style="{ color: getTravelModeColor(tripType.iconMode) }"
          />
          <span class="font-semibold text-foreground/80">{{ t(`directions.tripTypes.${tripType.key}`) }}</span>
        </span>

        <template v-if="trip.cost?.total">
          <span class="size-0.5 rounded-full bg-muted-foreground/50" />
          <span class="tabular-nums">${{ trip.cost.total.amount.toFixed(2) }}</span>
        </template>

        <template v-if="trip.co2Emissions != null && trip.co2Emissions > 0">
          <span class="size-0.5 rounded-full bg-muted-foreground/50" />
          <span class="tabular-nums">{{ formatCo2(trip.co2Emissions) }} CO₂</span>
        </template>
      </div>

      <!-- First transit leg headsign — one quiet line instead of a card row -->
      <div
        v-if="firstTransitHeadsign"
        class="mt-1 text-[11px] text-muted-foreground truncate pr-4"
      >
        {{ firstTransitHeadsign }}
      </div>
    </div>
  </div>
</template>
