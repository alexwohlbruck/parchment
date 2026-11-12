<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { arrivalZone, spareZones, type Race, type RaceZoneKind } from '@/lib/directions/trip-advice'
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

const ZONE_COLORS: Record<RaceZoneKind, string> = {
  calm: 'bg-forest-400',
  leave: 'bg-forest-600',
  hurry: 'bg-amber-500',
  run: 'bg-orange-600',
  tooFar: 'bg-red-600',
}
const zone = computed(() => arrivalZone(props.race, props.nowMs))

/** The track, with the outermost zones stretched to the timeline's ends. */
const segments = computed(() => {
  const zones = spareZones(props.race, props.nowMs)
  return zones.map((z, i) => {
    const latest = i === 0 ? LATEST : z.fromMs
    const earliest = i === zones.length - 1 ? EARLIEST : z.toMs
    return { kind: z.kind, left: pct(earliest), width: `${(at(latest) - at(earliest)) * 100}%`, color: ZONE_COLORS[z.kind] }
  })
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
      <div
        v-for="s in segments"
        :key="s.kind"
        class="absolute top-1/2 h-1.5 -translate-y-1/2 transition-all duration-700 first:rounded-l-full last:rounded-r-full"
        :class="[s.color, s.kind === zone ? 'opacity-100' : 'opacity-30']"
        :style="{ left: s.left, width: s.width }"
      />
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
