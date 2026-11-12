<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { spareZones, type Race } from '@/lib/directions/trip-advice'
import { formatClockCompact } from '@/lib/directions/trip-display'

/** When you reach the stop, on a fixed timeline around the departure: walking slower drags the marker later. */
const props = defineProps<{
  race: Race
  nowMs: number
  lineName?: string
}>()

const { t } = useI18n()

const MIN = 60_000
const LATEST = -5 * MIN
const EARLIEST = 10 * MIN
const TICKS = [10, 5, 0, -5].map(m => m * MIN)
/** Position of a spare time on the timeline: the earliest arrival is at the left. */
const at = (spareMs: number) => (EARLIEST - Math.min(EARLIEST, Math.max(LATEST, spareMs))) / (EARLIEST - LATEST)
const pct = (spareMs: number) => `${at(spareMs) * 100}%`

/** Half the width over which one zone's colour blends into the next, as a share of the track. */
const BLEND = 0.04

/** One gradient across the track, each zone's colour easing into its neighbour's at their boundary. */
const gradient = computed(() => {
  const zones = spareZones(props.race, props.nowMs)
    .reverse()
    .map(z => ({ kind: z.kind, left: at(z.toMs), right: at(z.fromMs) }))
    .filter(z => z.right > z.left)
  const stops = zones.flatMap((z, i) => {
    const edge = Math.min(BLEND, (z.right - z.left) / 2)
    const from = i === 0 ? 0 : z.left + edge
    const to = i === zones.length - 1 ? 1 : z.right - edge
    return [`var(--zone-${z.kind}) ${from * 100}%`, `var(--zone-${z.kind}) ${to * 100}%`]
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
})

const ticks = computed(() =>
  TICKS.map((spareMs, i) => ({
    spareMs,
    text: formatClockCompact(new Date(props.race.departAtMs - spareMs)),
    style: { left: pct(spareMs), transform: `translateX(-${i === 0 ? 0 : i === TICKS.length - 1 ? 100 : 50}%)` },
  })),
)

const spareMin = computed(() => props.race.spareMs / MIN)
const text = computed(() =>
  props.race.spareMs < 0
    ? t('directions.advice.status.short', { minutes: Math.max(1, Math.ceil(-spareMin.value)) })
    : spareMin.value < 1
      ? t('directions.advice.status.spareNone')
      : t('directions.advice.status.spare', { minutes: Math.floor(spareMin.value) }),
)
const marker = computed(() => {
  const p = at(props.race.spareMs) * 100
  return { left: `${p}%`, label: { left: `${p}%`, transform: `translateX(-${p}%)` } }
})

const label = computed(() =>
  t('directions.advice.race.label', {
    walk: Math.round(props.race.walkMs / MIN),
    train: Math.max(0, Math.floor((props.race.departAtMs - props.nowMs) / MIN)),
    line: props.lineName ?? '',
  }),
)
</script>

<template>
  <div role="img" :aria-label="label" class="text-xs tabular-nums text-muted-foreground">
    <div class="relative mb-1 h-4">
      <span class="absolute whitespace-nowrap font-medium text-foreground transition-all duration-700" :style="marker.label">
        {{ text }}
      </span>
    </div>
    <div class="relative h-[18px]">
      <div class="zones absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" :style="{ backgroundImage: gradient }" />
      <div class="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70" :style="{ left: pct(0) }" />
      <div
        class="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-sm ring-[3px] ring-primary/25 transition-[left] duration-700"
        :style="{ left: marker.left }"
      />
    </div>
    <div class="relative mt-1 h-4">
      <span
        v-for="tick in ticks"
        :key="tick.spareMs"
        class="absolute whitespace-nowrap"
        :class="tick.spareMs === 0 && 'font-medium text-foreground'"
        :style="tick.style"
      >
        {{ tick.text }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.zones {
  --zone-calm: #2a9d8f;
  --zone-leave: #3f9b5a;
  --zone-hurry: #e0a100;
  --zone-run: #e86a1c;
  --zone-tooFar: #d93b3b;
}
.dark .zones {
  --zone-calm: #5cc8b8;
  --zone-leave: #6fcf7f;
  --zone-hurry: #f5c542;
  --zone-run: #ff8a3d;
  --zone-tooFar: #ff5c5c;
}
</style>
