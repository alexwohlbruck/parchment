<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import { useI18n } from 'vue-i18n'
import { useMapService } from '@/services/map/map.service'
import { useUnits } from '@/composables/useUnits'
import { getTravelModeCssClass } from '@/lib/directions/travel-mode-colors'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import TripMeta from './TripMeta.vue'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import type { AdviceStatus } from '@/lib/directions/trip-advice'
import type {
  TripOption,
  TripsResponse,
} from '@/types/directions.types'
import { TravelMode } from '@/types/directions.types'
import { formatDurationParts } from '@/lib/time-format'

interface Props {
  trip: TripOption
  status?: AdviceStatus | null
  tripRequest: TripsResponse['request']
  timelineStart: Date
  pxPerMinute: number
  sidebarWidth: number
  /** Visible width of the bar column; bounds the pinned summary. */
  barAreaWidth: number
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
// A walking-only trip (no transit/vehicle leg) renders as a single solid
// blue pill, like driving/cycling. The dotted walk-tick track is reserved
// for walking *segments* inside a multimodal trip, where it distinguishes
// access/transfer walks from the vehicle pills.
const isWalkingOnly = computed(() =>
  props.trip.segments.length > 0 &&
  props.trip.segments.every((s) => s.mode === 'walking'),
)

const trackSpans = computed(() => {
  if (isWalkingOnly.value) return []
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

function formatDurationString(seconds: number) {
  const { parts } = formatDurationParts(seconds)
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

// Walking segments don't render as rides — the dotted track shows through,
// Transit-app style. A walking-only trip draws its walk as a ride instead, so
// it isn't a lone dotted track.
function isRide(segment: typeof props.trip.segments[0]): boolean {
  return segment.mode !== 'walking' || isWalkingOnly.value
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
    class="grid py-3 transition-colors"
    :class="{ 'cursor-pointer hover:bg-accent/50': isClickable }"
    :style="{ gridTemplateColumns: sidebarWidth ? `${sidebarWidth}px 1fr` : 'auto 1fr' }"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
  >
    <!-- Duration sidebar -->
    <div data-sidebar class="text-right tabular-nums pt-0.5 pl-3 pr-5 whitespace-nowrap">
      <div class="text-base font-semibold leading-tight">
        <template v-for="(part, i) in formatDurationParts(trip.summary.totalDuration).parts" :key="i">
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

        <!-- Rides: the line's bullet where it boards, then a thin bar in its
             colour for as long as it runs. Walking stays as the dotted track. -->
        <template v-for="(segment, i) in trip.segments" :key="segment.id">
          <div
            v-if="isRide(segment)"
            class="absolute top-1/2 -translate-y-1/2 h-full flex items-center"
            :style="{ left: `${segLeft(segment)}px`, width: `${segW(segment)}px`, zIndex: i + 1 }"
            :title="getSegmentTooltip(segment)"
          >
            <div
              data-bar
              class="absolute inset-x-0 h-2 rounded-full"
              :class="!segment.lineColor && getTravelModeCssClass(segment.mode)"
              :style="segment.lineColor ? { background: `#${segment.lineColor}` } : {}"
            />
            <RouteBullet
              v-if="segment.mode === 'transit' && segment.lineName"
              class="relative shrink-0"
              :label="segment.lineName"
              :color="segment.lineColor"
              :text-color="segment.lineTextColor"
            />
            <div
              v-else
              class="relative size-[22px] shrink-0 grid place-items-center rounded-full text-white depth-raised"
              :class="!segment.lineColor && getTravelModeCssClass(segment.mode)"
              :style="segment.lineColor ? { background: `#${segment.lineColor}` } : {}"
            >
              <component :is="getSegmentIcon(segment.mode, segment.routeType)" class="size-3" />
            </div>
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

      <!-- Trip summary — travels with the bar, then pins at the panel edge -->
      <div class="sticky left-3 w-fit" :style="{ maxWidth: `${barAreaWidth}px` }">
        <TripMeta :trip="trip" :status="status" class="mt-1.5 pr-4" />
      </div>
    </div>
  </div>
</template>
