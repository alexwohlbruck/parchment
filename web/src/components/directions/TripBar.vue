<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import { useI18n } from 'vue-i18n'
import { useUnits } from '@/composables/useUnits'
import { getTravelModeCssClass } from '@/lib/directions/travel-mode-colors'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { formatDurationParts } from '@/lib/time-format'
import { tripBarScale } from '@/lib/directions/trip-bar-scale'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import WaypointNode from '@/components/directions/trip/WaypointNode.vue'
import type { RouteWaypointDisplay } from '@/composables/directions/useRouteWaypoints'

interface BarSegment {
  id?: string
  mode: string
  startTime: Date | string
  endTime?: Date | string
  duration: number
  distance?: number
  waitSeconds?: number
  legIndex?: number
  lineName?: string
  lineColor?: string | null
  lineTextColor?: string | null
  routeType?: string
}

const props = defineProps<{
  segments: BarSegment[]
  /** Where x = 0 falls on the clock. */
  timelineStart: Date | string
  pxPerMinute: number
  /** Caps drawn as the timeline's waypoint icons, which take `inset` px clear of the rides at each end. */
  waypoints?: RouteWaypointDisplay[]
  inset?: number
}>()

const { t } = useI18n()
const { formatDistance } = useUnits()

const startMs = computed(() => dayjs(props.timelineStart).valueOf())

const endOf = (segment: BarSegment) =>
  dayjs(segment.endTime ?? dayjs(segment.startTime).add(segment.duration, 'second')).valueOf()

const x = computed(() => {
  const end = Math.max(startMs.value, ...props.segments.map(endOf))
  return tripBarScale(props.segments, startMs.value, end, ((end - startMs.value) / 60000) * props.pxPerMinute, props.inset)
})

function segLeft(segment: BarSegment) {
  return x.value(dayjs(segment.startTime).valueOf())
}

function segEnd(segment: BarSegment) {
  return x.value(endOf(segment))
}

function segW(segment: BarSegment) {
  return Math.max(x.value(dayjs(segment.startTime).valueOf() + segment.duration * 1000) - segLeft(segment), 4)
}

/** Waits shorter than this aren't worth a visual break in the ticks. */
const MIN_WAIT_SEC = 30

// A walking-only trip draws its walk as a solid pill; the tick track marks walks between rides.
const isWalkingOnly = computed(() => props.segments.length > 0 && props.segments.every(s => s.mode === 'walking'))

/** Walking as tall ticks, then the wait folded onto its end as dots, one per minute. */
const trackSpans = computed(() => {
  if (isWalkingOnly.value) return []
  const spans: { left: number; width: number; type: 'walk' | 'wait'; minutes: number }[] = []
  for (const seg of props.segments) {
    if (seg.mode !== 'walking') continue
    const dur = seg.duration || 0
    if (dur <= 0) continue
    const from = dayjs(seg.startTime).valueOf()
    const waitSec = seg.waitSeconds ?? 0
    const walkSec = waitSec >= MIN_WAIT_SEC ? dur - waitSec : dur
    const left = x.value(from)
    const mid = x.value(from + walkSec * 1000)
    const right = x.value(from + dur * 1000)
    if (mid - left > 0.5) spans.push({ left, width: mid - left, type: 'walk', minutes: walkSec / 60 })
    if (walkSec < dur) spans.push({ left: mid, width: right - mid, type: 'wait', minutes: (dur - walkSec) / 60 })
  }
  return spans
})

// Crisp pill ticks need an SVG mask; a gradient would anti-alias them into ovals.
const TICK_COLOR = 'hsl(var(--muted-foreground) / 0.6)'
const TICK_W = 2.5

function tickStyle(span: { width: number; type: 'walk' | 'wait'; minutes: number }) {
  const h = span.type === 'walk' ? 9 : TICK_W
  const count = Math.max(1, Math.min(Math.round(span.minutes), Math.floor(span.width / (TICK_W * 2))))
  const tile = span.width / count
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${h}"><rect x="${(tile - TICK_W) / 2}" width="${TICK_W}" height="${h}" rx="${TICK_W / 2}"/></svg>`
  const mask = `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') 0 center / ${tile}px ${h}px repeat-x`
  return { backgroundColor: TICK_COLOR, mask, WebkitMask: mask }
}

function tooltip(segment: BarSegment): string {
  const duration = formatDurationParts(segment.duration).parts.map(p => `${p.value}${p.unit}`).join(' ')
  const distance = segment.distance ? formatDistance(segment.distance) : ''
  const mode = t(`directions.modes.${segment.mode === 'biking' ? 'cycling' : segment.mode}`)
  return `${mode}: ${duration}${distance ? `, ${distance}` : ''}`
}

/** Cap positions: the start, then the end of every leg between waypoints. */
const caps = computed(() => {
  const segs = props.segments
  if (!segs.length) return []
  const positions = [segLeft(segs[0])]
  segs.forEach((seg, i) => {
    if (segs[i + 1]?.legIndex === seg.legIndex) return
    positions.push(Math.max(segEnd(seg), segLeft(seg) + segW(seg)))
  })
  return positions
})

/** The end caps sit centred in the inset, clear of the first and last ride. */
function capX(pos: number, i: number) {
  const half = (props.inset ?? 0) / 2
  return i === 0 ? pos - half : i === caps.value.length - 1 ? pos + half : pos
}

// Walks show through as the tick track, Transit-app style, unless the whole trip is a walk.
const isRide = (segment: BarSegment) => segment.mode !== 'walking' || isWalkingOnly.value
</script>

<template>
  <div class="relative h-7 flex items-center">
    <div class="absolute inset-x-0 h-px top-1/2 -translate-y-1/2 bg-border/30" />

    <div
      v-for="(span, i) in trackSpans"
      :key="`track-${i}`"
      class="absolute top-1/2 -translate-y-1/2"
      :class="span.type === 'walk' ? 'h-2.5' : 'h-1.5'"
      :style="{ left: `${span.left}px`, width: `${span.width}px`, ...tickStyle(span) }"
    />

    <template v-if="waypoints?.length === caps.length">
      <WaypointNode
        v-for="(pos, i) in caps"
        :key="`wp-${i}`"
        :waypoint="waypoints[i]"
        size="bar"
        class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-[60]"
        :style="{ left: `${capX(pos, i)}px` }"
      />
    </template>
    <div
      v-else-if="caps.length"
      class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-2.5 rounded-full bg-background border-[1.5px] border-foreground/60 z-[20] shadow-xs"
      :style="{ left: `${caps[0]}px` }"
    />

    <!-- Rides: the line's bullet where it boards, then a bar in its colour for as long as it runs. -->
    <template v-for="(segment, i) in segments" :key="segment.id ?? i">
      <div
        v-if="isRide(segment)"
        class="absolute top-1/2 -translate-y-1/2 h-full flex items-center"
        :style="{ left: `${segLeft(segment)}px`, width: `${segW(segment)}px`, zIndex: i + 1 }"
        :title="tooltip(segment)"
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
          :color="segment.lineColor ?? undefined"
          :text-color="segment.lineTextColor ?? undefined"
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

    <template v-if="waypoints?.length !== caps.length">
    <div
      v-if="caps.length > 1"
      class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-2.5 rounded-full bg-primary border-[1.5px] border-white z-[20] shadow-xs"
      :style="{ left: `${caps.at(-1)}px` }"
    />
    <div
      v-for="(pos, i) in caps.slice(1, -1)"
      :key="`cap-${i}`"
      class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-2 rounded-full bg-background border-[1.5px] border-primary z-[20]"
      :style="{ left: `${pos}px` }"
    />
    </template>
    <slot />
  </div>
</template>
