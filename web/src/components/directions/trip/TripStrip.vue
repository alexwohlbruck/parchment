<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useElementSize } from '@vueuse/core'
import TripBar from '@/components/directions/TripBar.vue'
import { formatClock } from '@/lib/directions/trip-display'
import { getTravelModeColor } from '@/lib/directions/travel-mode-colors'
import { stripX, tripStrip, type StripSegment } from '@/lib/directions/trip-strip'

const props = defineProps<{
  segments: (StripSegment & { lineName?: string; lineTextColor?: string | null; legIndex?: number })[]
  /** Live: how far along the trip the traveller is. */
  progress?: { segment: number; offset: number } | null
}>()

/** Profile height; its baseline sits on the bar's centre line. */
const H = 44
const BAR_CENTER = 14

const id = useId()
const inner = ref<HTMLElement | null>(null)
const { width } = useElementSize(inner)

const start = computed(() => new Date(props.segments[0]?.startTime ?? 0))
const minutes = computed(() => {
  const end = props.segments.at(-1)?.endTime
  return end ? Math.max(1, (new Date(end).getTime() - start.value.getTime()) / 60000) : 1
})
const pxPerMinute = computed(() => width.value / minutes.value)

const model = computed(() => tripStrip(props.segments))

const colorOf = (index: number) => {
  const segment = props.segments[index]
  return segment.lineColor ? `#${segment.lineColor}` : getTravelModeColor(segment.mode)
}

const y = (v: number) => 2 + (1 - v) * (H - 8)

const profiles = computed(() =>
  model.value.profiles.map(({ index, points }) => {
    const w = width.value
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${(p.x * w).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ')
    const first = points[0].x * w
    const last = points.at(-1)!.x * w
    return { index, line, area: `${line} L${last.toFixed(1)} ${H} L${first.toFixed(1)} ${H}Z`, color: colorOf(index) }
  }),
)

/** Where the bar's centre line sits below the top of the strip. */
const barY = computed(() => (profiles.value.length ? H : BAR_CENTER))

const markers = computed(() => (profiles.value.length ? model.value.markers.map(m => m.x * width.value) : []))

const progressX = computed(() =>
  props.progress ? stripX(model.value, props.segments, props.progress.segment, props.progress.offset) * width.value : null,
)

const startLabel = computed(() => (props.segments.length ? formatClock(start.value) : ''))
const endLabel = computed(() => (props.segments.length ? formatClock(new Date(props.segments.at(-1)!.endTime)) : ''))
</script>

<template>
  <div v-if="segments.length" class="px-3">
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
            <linearGradient v-for="p in profiles" :id="`${id}-fade-${p.index}`" :key="p.index" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" :stop-color="p.color" stop-opacity="0.3" />
              <stop offset="1" :stop-color="p.color" stop-opacity="0" />
            </linearGradient>
          </defs>
          <g v-for="p in profiles" :key="p.index">
            <path :d="p.area" :fill="`url(#${id}-fade-${p.index})`" />
            <path :d="p.line" fill="none" :stroke="p.color" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
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
