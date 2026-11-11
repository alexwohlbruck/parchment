<script setup lang="ts">
import { computed, useId } from 'vue'
import { formatClock, modeTextColor } from '@/lib/directions/trip-display'
import { stripX, tripStrip, type StripSegment } from '@/lib/directions/trip-strip'

const props = defineProps<{
  segments: StripSegment[]
  /** Live: how far along the trip the traveller is. */
  progress?: { segment: number; offset: number } | null
}>()

const W = 320
const BAR_Y = 46
const BAR_H = 5
const TOP = 4
const GAP = 1.5

const id = useId()
const model = computed(() => tripStrip(props.segments))
const height = computed(() => (model.value.profiles.length ? BAR_Y + BAR_H : BAR_H))
const barY = computed(() => height.value - BAR_H)

const colorOf = (index: number) => {
  const segment = props.segments[index]
  return segment.lineColor
    ? { class: '', style: { color: `#${segment.lineColor}` } }
    : { class: modeTextColor(segment.mode), style: {} }
}

const bars = computed(() =>
  model.value.legs.flatMap(leg => {
    const moving = { key: `m${leg.index}`, x: leg.x0 * W + GAP, w: Math.max(2, (leg.x1 - leg.x0) * W - GAP * 2), wait: false, ...colorOf(leg.index) }
    const waitW = (leg.xEnd - leg.x1) * W - GAP * 2
    return waitW > 2 ? [moving, { key: `w${leg.index}`, x: leg.x1 * W + GAP, w: waitW, wait: true, class: '', style: {} }] : [moving]
  }),
)

const y = (v: number) => TOP + (1 - v) * (BAR_Y - TOP - 4)

const profiles = computed(() =>
  model.value.profiles.map(({ index, points }) => {
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${(p.x * W).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ')
    const first = points[0].x * W
    const last = points.at(-1)!.x * W
    return { index, line, area: `${line} L${last.toFixed(1)} ${BAR_Y} L${first.toFixed(1)} ${BAR_Y}Z`, ...colorOf(index) }
  }),
)

const markers = computed(() => (model.value.profiles.length ? model.value.markers.map(m => ({ ...m, x: m.x * W })) : []))

const progressX = computed(() =>
  props.progress ? stripX(model.value, props.segments, props.progress.segment, props.progress.offset) * W : null,
)

const startLabel = computed(() => (props.segments[0] ? formatClock(new Date(props.segments[0].startTime)) : ''))
const endLabel = computed(() => (props.segments.length ? formatClock(new Date(props.segments.at(-1)!.endTime)) : ''))
</script>

<template>
  <div v-if="segments.length">
    <svg :viewBox="`0 0 ${W} ${height}`" class="block w-full h-auto overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient
          v-for="p in profiles"
          :id="`${id}-fade-${p.index}`"
          :key="p.index"
          :class="p.class"
          :style="p.style"
          x1="0" y1="0" x2="0" y2="1"
        >
          <stop offset="0" stop-color="currentColor" stop-opacity="0.3" />
          <stop offset="1" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g v-for="p in profiles" :key="p.index" :class="p.class" :style="p.style">
        <path :d="p.area" :fill="`url(#${id}-fade-${p.index})`" />
        <path :d="p.line" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
      </g>
      <rect
        v-for="bar in bars"
        :key="bar.key"
        :x="bar.x"
        :y="barY"
        :width="bar.w"
        :height="BAR_H"
        :rx="BAR_H / 2"
        :class="bar.wait ? 'fill-muted-foreground/30' : bar.class"
        :style="bar.style"
        :fill="bar.wait ? undefined : 'currentColor'"
      />
      <path
        v-for="(m, i) in markers"
        :key="i"
        :d="`M${m.x} ${BAR_Y - 6} l3.5 5 h-7z`"
        class="fill-amber-700 dark:fill-amber-400"
      />
      <template v-if="progressX != null">
        <rect :x="progressX" y="0" :width="W - progressX + GAP" :height="height + 1" class="fill-background/55" />
        <line
          v-if="profiles.length"
          :x1="progressX" :x2="progressX" :y1="TOP" :y2="barY"
          class="stroke-primary" stroke-width="1.5" stroke-dasharray="2 2"
        />
        <circle :cx="progressX" :cy="barY + BAR_H / 2" r="5" class="fill-primary stroke-background" stroke-width="2" />
      </template>
    </svg>
    <div class="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
      <span>{{ startLabel }}</span>
      <span>{{ endLabel }}</span>
    </div>
  </div>
</template>
