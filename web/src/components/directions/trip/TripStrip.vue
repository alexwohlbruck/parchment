<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useElementSize } from '@vueuse/core'
import TripBar from '@/components/directions/TripBar.vue'
import { formatClock } from '@/lib/directions/trip-display'
import { getTravelModeColor } from '@/lib/directions/travel-mode-colors'
import { colorRuns, stripX, tripStrip, type StripSegment } from '@/lib/directions/trip-strip'
import type { RouteProfileType } from '@/lib/directions/route-profile-colors'
import { tripBarScale } from '@/lib/directions/trip-bar-scale'
import type { RouteWaypointDisplay } from '@/composables/directions/useRouteWaypoints'

const props = defineProps<{
  segments: (StripSegment & { lineName?: string; lineTextColor?: string | null; legIndex?: number })[]
  /** Live: how far along the trip the traveller is. */
  progress?: { segment: number; offset: number } | null
  waypoints?: RouteWaypointDisplay[]
  /** Colour the profile by this instead of by travel mode, on the legs it covers. */
  colorBy?: RouteProfileType | null
  /** Carry the background above it down to the bar's centre line, so the strip straddles the edge between the two. */
  fold?: boolean
}>()

/** Room at each end for a waypoint icon. */
const INSET = 22

/** Profile height; its baseline sits on the bar's centre line. */
const H = 44
const BAR_CENTER = 14

const id = useId()
const root = ref<HTMLElement | null>(null)
const inner = ref<HTMLElement | null>(null)
const { width } = useElementSize(inner)
const { height: rootHeight } = useElementSize(root)

const start = computed(() => new Date(props.segments[0]?.startTime ?? 0))
const minutes = computed(() => {
  const end = props.segments.at(-1)?.endTime
  return end ? Math.max(1, (new Date(end).getTime() - start.value.getTime()) / 60000) : 1
})
const pxPerMinute = computed(() => width.value / minutes.value)

const model = computed(() => tripStrip(props.segments))

/** A strip fraction in px, on the same scale the bar lays its rides out on. */
const px = computed(() => {
  const t0 = start.value.getTime()
  const span = minutes.value * 60000
  const scale = tripBarScale(props.segments, t0, t0 + span, width.value, INSET)
  return (f: number) => scale(t0 + f * span)
})

const colorOf = (index: number) => {
  const segment = props.segments[index]
  return segment.lineColor ? `#${segment.lineColor}` : getTravelModeColor(segment.mode)
}

const y = (v: number) => 2 + (1 - v) * (H - 8)

/** Hard colour stops across a leg, as offsets between its first and last x. */
function stopsOf(index: number, first: number, last: number) {
  const runs = props.colorBy ? colorRuns(props.segments[index], model.value.legs[index], props.colorBy) : []
  if (!runs.length) return [{ offset: 0, color: colorOf(index) }, { offset: 1, color: colorOf(index) }]
  const offset = (x: number) => Math.min(1, Math.max(0, (px.value(x) - first) / (last - first || 1)))
  return runs.flatMap(r => [{ offset: offset(r.x0), color: r.color }, { offset: offset(r.x1), color: r.color }])
}

const profiles = computed(() =>
  model.value.profiles.map(({ index, points }) => {
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${px.value(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ')
    const first = px.value(points[0].x)
    const last = px.value(points.at(-1)!.x)
    return { index, line, area: `${line} L${last.toFixed(1)} ${H} L${first.toFixed(1)} ${H}Z`, first, last, stops: stopsOf(index, first, last) }
  }),
)

/** Where the bar's centre line sits below the top of the strip. */
const barY = computed(() => (profiles.value.length ? H : BAR_CENTER))

const foldY = computed(() => (rootHeight.value >= 0 && inner.value ? inner.value.offsetTop + barY.value : 0))

const markers = computed(() => (profiles.value.length ? model.value.markers.map(m => px.value(m.x)) : []))

const progressX = computed(() =>
  props.progress ? px.value(stripX(model.value, props.segments, props.progress.segment, props.progress.offset)) : null,
)

const startLabel = computed(() => (props.segments.length ? formatClock(start.value) : ''))
const endLabel = computed(() => (props.segments.length ? formatClock(new Date(props.segments.at(-1)!.endTime)) : ''))
</script>

<template>
  <div v-if="segments.length" ref="root" class="relative isolate px-3">
    <div v-if="fold" class="absolute -inset-x-3 top-0 -z-10 bg-background" :style="{ height: `${foldY}px` }" />
    <slot />
    <div ref="inner" class="relative">
      <template v-if="profiles.length && width">
        <div :style="{ height: `${H - BAR_CENTER}px` }" />
        <svg
          class="pointer-events-none absolute left-0 top-0 w-full overflow-visible"
          :height="H"
          :viewBox="`0 0 ${width} ${H}`"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient :id="`${id}-fade`" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="white" stop-opacity="0.3" />
              <stop offset="1" stop-color="white" stop-opacity="0" />
            </linearGradient>
            <mask :id="`${id}-fade-mask`" maskUnits="userSpaceOnUse" x="0" y="0" :width="width" :height="H">
              <rect x="0" y="0" :width="width" :height="H" :fill="`url(#${id}-fade)`" />
            </mask>
            <linearGradient
              v-for="p in profiles"
              :id="`${id}-ink-${p.index}`"
              :key="p.index"
              gradientUnits="userSpaceOnUse"
              :x1="p.first" :x2="p.last" y1="0" y2="0"
            >
              <stop v-for="(stop, i) in p.stops" :key="i" :offset="stop.offset" :stop-color="stop.color" />
            </linearGradient>
          </defs>
          <g v-for="p in profiles" :key="p.index">
            <path :d="p.area" :fill="`url(#${id}-ink-${p.index})`" :mask="`url(#${id}-fade-mask)`" />
            <path :d="p.line" fill="none" :stroke="`url(#${id}-ink-${p.index})`" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
          </g>
          <path
            v-for="(x, i) in markers"
            :key="i"
            :d="`M${x} ${H - 13} l3.5 5 h-7z`"
            class="fill-amber-600 dark:fill-amber-400"
          />
          <line
            v-if="progressX != null"
            :x1="progressX" :x2="progressX" y1="2" :y2="H"
            class="stroke-primary" stroke-width="1.5" stroke-dasharray="2 2"
          />
        </svg>
      </template>
      <TripBar
        v-if="width"
        :segments="segments"
        :timeline-start="start"
        :px-per-minute="pxPerMinute"
        :waypoints="waypoints"
        :inset="INSET"
      />
      <template v-if="progressX != null">
        <div
          class="pointer-events-none absolute inset-y-0 right-[-12px] z-[30] bg-background/55"
          :style="{ left: `${progressX}px` }"
        />
        <div
          class="pointer-events-none absolute z-[40] size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-sm"
          :style="{ left: `${progressX}px`, top: `${barY}px` }"
        />
      </template>
    </div>
    <div class="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
      <span>{{ startLabel }}</span>
      <span>{{ endLabel }}</span>
    </div>
  </div>
</template>
