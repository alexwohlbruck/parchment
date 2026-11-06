<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FootprintsIcon } from 'lucide-vue-next'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { raceZones, type Race, type RaceZoneKind } from '@/lib/directions/trip-advice'

/** The walk to the first stop on one bar, with the train's departure marked where it falls. */
const props = defineProps<{
  race: Race
  nowMs: number
  ride?: { routeType?: string; lineColor?: string; lineName?: string }
}>()

const { t } = useI18n()

const leadMs = computed(() => Math.max(0, props.race.departAtMs - props.nowMs))
const scale = computed(() => Math.max(props.race.walkMs, leadMs.value, 1))
const share = (ms: number) => Math.min(100, (ms / scale.value) * 100)

const ZONE_COLORS: Record<RaceZoneKind, string> = {
  calm: 'bg-forest-500',
  leave: 'bg-yellow-400',
  hurry: 'bg-amber-400',
  run: 'bg-orange-600',
  tooFar: 'bg-red-600',
}
const zones = computed(() =>
  raceZones(props.race, leadMs.value).map(z => ({
    kind: z.kind,
    color: ZONE_COLORS[z.kind],
    style: { left: `${share(z.fromMs)}%`, width: `${share(z.toMs) - share(z.fromMs)}%` },
  })),
)
const walkClip = computed(() => ({ clipPath: `inset(0 ${100 - share(props.race.walkMs)}% 0 0 round 9999px)` }))
/** Pins a label to a point on the bar, sliding it inward so it never leaves the bar's span. */
const at = (ms: number) => ({ left: `${share(ms)}%`, transform: `translateX(-${share(ms)}%)` })

const minutes = (ms: number, round: (n: number) => number) => {
  const n = round(ms / 60_000)
  return n < 1 ? '<1' : String(n)
}
const walk = computed(() => minutes(props.race.walkMs, Math.round))
const train = computed(() => minutes(leadMs.value, Math.floor))

const rideIcon = computed(() => getSegmentIcon('transit', props.ride?.routeType))
const rideColor = computed(() => (props.ride?.lineColor ? `#${props.ride.lineColor}` : 'currentColor'))
const label = computed(() =>
  t('directions.advice.race', { walk: walk.value, train: train.value, line: props.ride?.lineName ?? '' }),
)
</script>

<template>
  <div role="img" :aria-label="label" class="mt-2 w-52 text-xs tabular-nums text-muted-foreground">
    <div class="relative h-4">
      <span class="absolute inline-flex items-center gap-1 whitespace-nowrap" :style="at(leadMs)">
        <component :is="rideIcon" class="size-3.5" :style="{ color: rideColor }" />{{ train }} min
      </span>
    </div>
    <div class="relative my-1.5 h-1.5">
      <div class="absolute inset-0 overflow-hidden rounded-full opacity-25">
        <div v-for="zone in zones" :key="zone.kind" class="absolute inset-y-0" :class="zone.color" :style="zone.style" />
      </div>
      <div class="absolute inset-0 overflow-hidden rounded-full transition-[clip-path] duration-700" :style="walkClip">
        <div v-for="zone in zones" :key="zone.kind" class="absolute inset-y-0" :class="zone.color" :style="zone.style" />
      </div>
      <div
        class="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full transition-[left] duration-700"
        :style="{ left: `${share(leadMs)}%`, background: rideColor }"
      />
    </div>
    <div class="relative h-4">
      <span class="absolute inline-flex items-center gap-1 whitespace-nowrap" :style="at(race.walkMs)">
        <FootprintsIcon class="size-3.5" />{{ walk }} min
      </span>
    </div>
  </div>
</template>
